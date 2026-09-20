package main

type CurvePolicyInput struct {
	FairCoupon     float64
	LockNonces     uint32
	RefNotionalUsd float64
}

type CurvePolicy struct {
	TotalTokenSupply      uint64
	InitialMarketCapUsd   uint64
	MigrationMarketCapUsd uint64
	LaunchFairPpm         uint32
}

const (
	minInitialMcap   = 5_000
	minMigrationMcap = 50_000
)

func fairCouponToPpm(fairCoupon float64) uint32 {
	if fairCoupon < 0 {
		fairCoupon = 0
	}
	if fairCoupon > 1 {
		fairCoupon = 1
	}
	ppm := uint32(fairCoupon * 1_000_000)
	if ppm == 0 {
		return 1
	}
	return ppm
}

func computeCurvePolicy(input CurvePolicyInput) CurvePolicy {
	lock := input.LockNonces
	if lock == 0 {
		lock = 1
	}
	fair := input.FairCoupon
	if fair < 0 {
		fair = 0
	}
	if fair > 1 {
		fair = 1
	}
	ref := input.RefNotionalUsd
	if ref <= 0 {
		ref = 100
	}

	yieldNotional := ref * fair * float64(lock)
	initial := uint64(minInitialMcap)
	if yieldNotional > float64(minInitialMcap)*0.5 {
		initial = uint64(yieldNotional)
		if initial < minInitialMcap {
			initial = minInitialMcap
		}
	}

	migration := initial * 15
	if migration < minMigrationMcap {
		migration = minMigrationMcap
	}

	supply := uint64(lock) * 1_000_000
	if supply < 1_000_000 {
		supply = 1_000_000
	}

	return CurvePolicy{
		TotalTokenSupply:      supply,
		InitialMarketCapUsd:   initial,
		MigrationMarketCapUsd: migration,
		LaunchFairPpm:         fairCouponToPpm(fair),
	}
}
