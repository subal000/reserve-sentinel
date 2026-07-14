package scoring

import (
	"math"
	"sync"
)

// VelocityWindow tracks recent net mint activity per asset and produces a
// z-score of the latest bucket vs the rolling baseline. A sudden spike in net
// minting is the "procurement stress" signal.
//
// Implementation is a fixed-size ring of per-bucket net-mint totals (mints
// minus burns, in UI units). The current bucket accumulates; Roll() advances
// the ring (call it once per bucket interval, e.g. per minute from the ticker).
type VelocityWindow struct {
	mu      sync.Mutex
	buckets []float64
	idx     int
	filled  bool
	cur     float64
}

// NewVelocityWindow keeps `size` historical buckets for the baseline.
func NewVelocityWindow(size int) *VelocityWindow {
	if size < 2 {
		size = 2
	}
	return &VelocityWindow{buckets: make([]float64, size)}
}

// Add records a mint (+amount) or burn (-amount) into the current bucket.
func (w *VelocityWindow) Add(netAmount float64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.cur += netAmount
}

// Roll finalizes the current bucket into the ring and starts a fresh one.
func (w *VelocityWindow) Roll() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buckets[w.idx] = w.cur
	w.cur = 0
	w.idx = (w.idx + 1) % len(w.buckets)
	if w.idx == 0 {
		w.filled = true
	}
}

// ZScoreX100 returns the z-score of the current (in-progress) bucket vs the
// mean/stddev of the completed buckets, scaled x100 to fit the on-chain i32.
// Returns 0 until there's enough history for a meaningful baseline.
func (w *VelocityWindow) ZScoreX100() int32 {
	w.mu.Lock()
	defer w.mu.Unlock()

	n := w.idx
	if w.filled {
		n = len(w.buckets)
	}
	if n < 2 {
		return 0
	}

	var sum float64
	for i := 0; i < n; i++ {
		sum += w.buckets[i]
	}
	mean := sum / float64(n)

	var variance float64
	for i := 0; i < n; i++ {
		d := w.buckets[i] - mean
		variance += d * d
	}
	variance /= float64(n)
	std := math.Sqrt(variance)
	if std == 0 {
		return 0
	}

	z := (w.cur - mean) / std
	return int32(math.Round(z * 100))
}
