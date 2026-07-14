package anchor

import (
	"encoding/binary"
	"fmt"

	"github.com/gagliardetto/solana-go"
)

// AssetScore mirrors the on-chain account layout (after the 8-byte Anchor
// discriminator). Field order and sizes must match programs/.../state.rs.
type AssetScore struct {
	Mint              solana.PublicKey
	Issuer            uint8
	UnderlyingTicker  [8]byte
	TrustTier         uint8
	Score             uint8
	PremiumBps        int32
	LiquidityDepthUSD uint64
	MintBurnZ         int32
	LastUpdated       int64
	Authority         solana.PublicKey
	Bump              uint8
}

// Ticker returns the underlying ticker as a trimmed string.
func (a AssetScore) Ticker() string {
	n := len(a.UnderlyingTicker)
	for n > 0 && (a.UnderlyingTicker[n-1] == ' ' || a.UnderlyingTicker[n-1] == 0) {
		n--
	}
	return string(a.UnderlyingTicker[:n])
}

// assetScoreLen is 8 (discriminator) + the sum of the fields above.
const assetScoreLen = 8 + 32 + 1 + 8 + 1 + 1 + 4 + 8 + 4 + 8 + 32 + 1

// DecodeAssetScore parses raw account data into an AssetScore.
func DecodeAssetScore(data []byte) (*AssetScore, error) {
	if len(data) < assetScoreLen {
		return nil, fmt.Errorf("account too short: %d < %d", len(data), assetScoreLen)
	}
	p := data[8:] // skip discriminator
	var a AssetScore
	off := 0
	copy(a.Mint[:], p[off:off+32])
	off += 32
	a.Issuer = p[off]
	off++
	copy(a.UnderlyingTicker[:], p[off:off+8])
	off += 8
	a.TrustTier = p[off]
	off++
	a.Score = p[off]
	off++
	a.PremiumBps = int32(binary.LittleEndian.Uint32(p[off : off+4]))
	off += 4
	a.LiquidityDepthUSD = binary.LittleEndian.Uint64(p[off : off+8])
	off += 8
	a.MintBurnZ = int32(binary.LittleEndian.Uint32(p[off : off+4]))
	off += 4
	a.LastUpdated = int64(binary.LittleEndian.Uint64(p[off : off+8]))
	off += 8
	copy(a.Authority[:], p[off:off+32])
	off += 32
	a.Bump = p[off]
	return &a, nil
}
