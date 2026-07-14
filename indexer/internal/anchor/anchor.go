// Package anchor builds and sends the update_score instruction to the
// reserve_sentinel program on-chain, and verifies tracked mints exist.
package anchor

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sync"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// token2022ProgramID is the Token Extensions program. Several tokenized stocks
// (e.g. CRCLon) are Token-2022 mints, so we accept either token program.
var token2022ProgramID = solana.MustPublicKeyFromBase58("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")

// assetScoreSeed matches the on-chain PDA seed prefix.
var assetScoreSeed = []byte("asset_score")

// ScoreUpdate is the payload for a single update_score call.
type ScoreUpdate struct {
	Mint              string
	Score             uint8
	PremiumBps        int32
	LiquidityDepthUSD uint64
	MintBurnZ         int32
}

// Client signs and submits update_score transactions with the authority key.
type Client struct {
	rpc                  *rpc.Client
	programID            solana.PublicKey
	authorityKeypairPath string

	once    sync.Once
	authKey solana.PrivateKey
	authErr error
}

func NewClient(rpcURL, programID, authorityKeypairPath string) *Client {
	pid, err := solana.PublicKeyFromBase58(programID)
	if err != nil {
		// Surface at construction; a bad program ID is a config error.
		panic(fmt.Sprintf("anchor: invalid program id %q: %v", programID, err))
	}
	return &Client{
		rpc:                  rpc.New(rpcURL),
		programID:            pid,
		authorityKeypairPath: authorityKeypairPath,
	}
}

// authority lazily loads (and caches) the signer keypair.
func (c *Client) authority() (solana.PrivateKey, error) {
	c.once.Do(func() {
		if c.authorityKeypairPath == "" {
			c.authErr = fmt.Errorf("AUTHORITY_KEYPAIR not set")
			return
		}
		c.authKey, c.authErr = solana.PrivateKeyFromSolanaKeygenFile(c.authorityKeypairPath)
	})
	return c.authKey, c.authErr
}

// AnchorDiscriminator computes the 8-byte instruction discriminator Anchor
// prepends to instruction data: sha256("global:<name>")[:8].
func AnchorDiscriminator(name string) [8]byte {
	sum := sha256.Sum256([]byte("global:" + name))
	var d [8]byte
	copy(d[:], sum[:8])
	return d
}

// rawInstruction is a minimal solana.Instruction implementation.
type rawInstruction struct {
	progID   solana.PublicKey
	accounts solana.AccountMetaSlice
	data     []byte
}

func (i *rawInstruction) ProgramID() solana.PublicKey     { return i.progID }
func (i *rawInstruction) Accounts() []*solana.AccountMeta { return i.accounts }
func (i *rawInstruction) Data() ([]byte, error)           { return i.data, nil }

// derivePDA returns the asset_score PDA for a mint: [b"asset_score", mint].
func (c *Client) derivePDA(mint solana.PublicKey) (solana.PublicKey, error) {
	pda, _, err := solana.FindProgramAddress([][]byte{assetScoreSeed, mint.Bytes()}, c.programID)
	return pda, err
}

// encodeUpdateScore builds the Borsh instruction data:
// discriminator ++ score(u8) premium_bps(i32) liquidity_depth_usd(u64) mint_burn_z(i32),
// all little-endian, no padding — matching the Rust argument order.
func encodeUpdateScore(u ScoreUpdate) []byte {
	disc := AnchorDiscriminator("update_score")
	buf := make([]byte, 0, 8+1+4+8+4)
	buf = append(buf, disc[:]...)
	buf = append(buf, u.Score)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(u.PremiumBps))
	buf = binary.LittleEndian.AppendUint64(buf, u.LiquidityDepthUSD)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(u.MintBurnZ))
	return buf
}

// UpdateScore builds, signs, and sends the update_score instruction.
func (c *Client) UpdateScore(ctx context.Context, upd ScoreUpdate) (string, error) {
	auth, err := c.authority()
	if err != nil {
		return "", err
	}
	authPub := auth.PublicKey()

	mint, err := solana.PublicKeyFromBase58(upd.Mint)
	if err != nil {
		return "", fmt.Errorf("bad mint: %w", err)
	}
	pda, err := c.derivePDA(mint)
	if err != nil {
		return "", fmt.Errorf("derive pda: %w", err)
	}

	ix := &rawInstruction{
		progID: c.programID,
		accounts: solana.AccountMetaSlice{
			// Order must match the Rust UpdateScore context: asset_score, authority.
			{PublicKey: pda, IsWritable: true, IsSigner: false},
			{PublicKey: authPub, IsWritable: false, IsSigner: true},
		},
		data: encodeUpdateScore(upd),
	}

	return c.sendTx(ctx, ix, auth)
}

// sendTx builds, signs (with the given signers; the first is the fee payer),
// and submits a single-instruction transaction.
func (c *Client) sendTx(ctx context.Context, ix solana.Instruction, signers ...solana.PrivateKey) (string, error) {
	if len(signers) == 0 {
		return "", fmt.Errorf("no signers")
	}
	payer := signers[0].PublicKey()

	recent, err := c.rpc.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("blockhash: %w", err)
	}
	tx, err := solana.NewTransaction(
		[]solana.Instruction{ix},
		recent.Value.Blockhash,
		solana.TransactionPayer(payer),
	)
	if err != nil {
		return "", fmt.Errorf("new tx: %w", err)
	}
	if _, err := tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		for i := range signers {
			if key.Equals(signers[i].PublicKey()) {
				return &signers[i]
			}
		}
		return nil
	}); err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	sig, err := c.rpc.SendTransactionWithOpts(ctx, tx, rpc.TransactionOpts{
		PreflightCommitment: rpc.CommitmentConfirmed,
	})
	if err != nil {
		return "", fmt.Errorf("send: %w", err)
	}
	return sig.String(), nil
}

// encodeInitializeAsset builds the Borsh instruction data for initialize_asset:
// discriminator ++ issuer(u8) ++ underlying_ticker([u8;8]) ++ trust_tier(u8) ++ authority(Pubkey).
func encodeInitializeAsset(issuer uint8, ticker [8]byte, trustTier uint8, authority solana.PublicKey) []byte {
	disc := AnchorDiscriminator("initialize_asset")
	buf := make([]byte, 0, 8+1+8+1+32)
	buf = append(buf, disc[:]...)
	buf = append(buf, issuer)
	buf = append(buf, ticker[:]...)
	buf = append(buf, trustTier)
	buf = append(buf, authority[:]...)
	return buf
}

// InitializeAsset creates the AssetScore PDA for a mint. This is an admin /
// one-time bootstrap operation (normally scripts/init_assets.ts); exposed here
// so the indexer (and tests) can self-provision. `payer` funds rent and signs.
func (c *Client) InitializeAsset(
	ctx context.Context,
	payer solana.PrivateKey,
	mint string,
	issuer uint8,
	ticker [8]byte,
	trustTier uint8,
	authority solana.PublicKey,
) (string, error) {
	mintPk, err := solana.PublicKeyFromBase58(mint)
	if err != nil {
		return "", fmt.Errorf("bad mint: %w", err)
	}
	pda, err := c.derivePDA(mintPk)
	if err != nil {
		return "", fmt.Errorf("derive pda: %w", err)
	}

	ix := &rawInstruction{
		progID: c.programID,
		accounts: solana.AccountMetaSlice{
			// Order matches the Rust InitializeAsset context:
			// mint, asset_score, payer, system_program.
			{PublicKey: mintPk, IsWritable: false, IsSigner: false},
			{PublicKey: pda, IsWritable: true, IsSigner: false},
			{PublicKey: payer.PublicKey(), IsWritable: true, IsSigner: true},
			{PublicKey: solana.SystemProgramID, IsWritable: false, IsSigner: false},
		},
		data: encodeInitializeAsset(issuer, ticker, trustTier, authority),
	}
	return c.sendTx(ctx, ix, payer)
}

// ReadAssetScore fetches and decodes the on-chain AssetScore for a mint.
func (c *Client) ReadAssetScore(ctx context.Context, mint string) (*AssetScore, error) {
	mintPk, err := solana.PublicKeyFromBase58(mint)
	if err != nil {
		return nil, fmt.Errorf("bad mint: %w", err)
	}
	pda, err := c.derivePDA(mintPk)
	if err != nil {
		return nil, fmt.Errorf("derive pda: %w", err)
	}
	out, err := c.rpc.GetAccountInfo(ctx, pda)
	if err != nil {
		return nil, fmt.Errorf("get account: %w", err)
	}
	if out == nil || out.Value == nil {
		return nil, fmt.Errorf("asset_score PDA %s not found", pda)
	}
	return DecodeAssetScore(out.Value.Data.GetBinary())
}

// VerifyMintExists checks that a mint account exists on the cluster and is
// owned by a token program (classic SPL or Token-2022).
func (c *Client) VerifyMintExists(ctx context.Context, mint string) error {
	pk, err := solana.PublicKeyFromBase58(mint)
	if err != nil {
		return fmt.Errorf("bad mint: %w", err)
	}
	out, err := c.rpc.GetAccountInfo(ctx, pk)
	if err != nil {
		return fmt.Errorf("get account: %w", err)
	}
	if out == nil || out.Value == nil {
		return fmt.Errorf("mint %s not found", mint)
	}
	owner := out.Value.Owner
	if !owner.Equals(solana.TokenProgramID) && !owner.Equals(token2022ProgramID) {
		return fmt.Errorf("mint %s owner %s is not a token program", mint, owner)
	}
	return nil
}
