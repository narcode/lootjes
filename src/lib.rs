//! Lootjes trekken: every participant draws `k` names such that
//! nobody draws themselves, nobody draws the same name twice, and
//! every name ends up in exactly `k` hands.
//!
//! Compiled to plain wasm (no bindings); the JS side passes a random
//! seed and reads the result from linear memory.

pub mod ticket;
mod wasm_api;

pub const MAX: usize = 32;

static mut RESULT: [u8; MAX * MAX] = [0; MAX * MAX];

/// xorshift64* — small, good enough for shuffling names.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn shuffle(&mut self, xs: &mut [u8]) {
        for i in (1..xs.len()).rev() {
            xs.swap(i, self.below(i + 1));
        }
    }
}

/// Fills `out[giver * k + j]` with the j-th name drawn by `giver`.
/// Returns false if no valid draw exists (k >= n) or none was found.
pub fn draw_into(n: usize, k: usize, seed: u64, out: &mut [u8]) -> bool {
    if n == 0 || k == 0 || k >= n || n > MAX || out.len() < n * k {
        return false;
    }
    let mut rng = Rng(seed | 1);

    // Random greedy fill with restarts; always the most constrained
    // receivers first so dead ends are rare.
    'attempt: for _ in 0..10_000 {
        let mut left = [k as u8; MAX];
        let mut givers: Vec<u8> = (0..n as u8).collect();
        rng.shuffle(&mut givers);

        for &g in &givers {
            let mut cands: Vec<u8> = (0..n as u8)
                .filter(|&r| r != g && left[r as usize] > 0)
                .collect();
            if cands.len() < k {
                continue 'attempt;
            }
            rng.shuffle(&mut cands);
            cands.sort_by_key(|&r| std::cmp::Reverse(left[r as usize]));
            for (j, &r) in cands[..k].iter().enumerate() {
                out[g as usize * k + j] = r;
                left[r as usize] -= 1;
            }
        }
        return true;
    }
    false
}

/// wasm entry point. Returns a pointer to `n * k` bytes, or 0 on failure.
#[unsafe(no_mangle)]
pub extern "C" fn draw(n: u32, k: u32, seed_hi: u32, seed_lo: u32) -> *const u8 {
    let seed = (seed_hi as u64) << 32 | seed_lo as u64;
    // SAFETY: wasm is single-threaded and JS copies the result before the next call.
    let out = unsafe { &mut *std::ptr::addr_of_mut!(RESULT) };
    if draw_into(n as usize, k as usize, seed, out) {
        out.as_ptr()
    } else {
        std::ptr::null()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(n: usize, k: usize, out: &[u8]) {
        let mut received = vec![0; n];
        for g in 0..n {
            let picks = &out[g * k..g * k + k];
            for (j, &r) in picks.iter().enumerate() {
                assert_ne!(r as usize, g, "drew self");
                assert!(!picks[..j].contains(&r), "duplicate name");
                received[r as usize] += 1;
            }
        }
        assert!(received.iter().all(|&c| c == k), "uneven: {received:?}");
    }

    #[test]
    fn seven_people_three_each() {
        for seed in 0..5_000 {
            let mut out = [0u8; 21];
            assert!(draw_into(7, 3, seed, &mut out));
            check(7, 3, &out);
        }
    }

    #[test]
    fn other_sizes() {
        for (n, k) in [(2, 1), (3, 2), (5, 4), (10, 3), (12, 5)] {
            for seed in 0..500 {
                let mut out = vec![0u8; n * k];
                assert!(draw_into(n, k, seed, &mut out), "n={n} k={k}");
                check(n, k, &out);
            }
        }
    }

    #[test]
    fn impossible() {
        let mut out = [0u8; 64];
        assert!(!draw_into(3, 3, 1, &mut out));
        assert!(!draw_into(0, 1, 1, &mut out));
    }
}
