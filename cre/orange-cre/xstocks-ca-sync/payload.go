package main

import (
	"encoding/binary"
	"fmt"

	"github.com/gagliardetto/solana-go"
)

// SyncEvent mirrors programs/ca_registry SyncEvent (borsh).
type SyncEvent struct {
	EventID       [16]byte
	CaType        uint8
	Kind          uint8
	EffectiveTs   int64
	MultiplierOld uint64
	MultiplierNew uint64
}

// SyncPayload mirrors programs/ca_registry SyncPayload (borsh).
type SyncPayload struct {
	Mint   solana.PublicKey
	Events []SyncEvent
}

func encodeSyncPayload(payload SyncPayload) ([]byte, error) {
	buf := make([]byte, 0, 256)
	buf = append(buf, payload.Mint[:]...)
	buf = appendU32(buf, uint32(len(payload.Events)))
	for _, event := range payload.Events {
		buf = append(buf, event.EventID[:]...)
		buf = append(buf, event.CaType)
		buf = append(buf, event.Kind)
		buf = appendI64(buf, event.EffectiveTs)
		buf = appendU64(buf, event.MultiplierOld)
		buf = appendU64(buf, event.MultiplierNew)
	}
	return buf, nil
}

func appendU32(buf []byte, value uint32) []byte {
	var scratch [4]byte
	binary.LittleEndian.PutUint32(scratch[:], value)
	return append(buf, scratch[:]...)
}

func appendU64(buf []byte, value uint64) []byte {
	var scratch [8]byte
	binary.LittleEndian.PutUint64(scratch[:], value)
	return append(buf, scratch[:]...)
}

func appendI64(buf []byte, value int64) []byte {
	return appendU64(buf, uint64(value))
}

func parseMultiplier(value string) (uint64, error) {
	if value == "" || value == "null" {
		return 0, nil
	}
	var f float64
	if _, err := fmt.Sscanf(value, "%f", &f); err != nil {
		return 0, fmt.Errorf("parse multiplier %q: %w", value, err)
	}
	return uint64(f * float64(multiplierScale)), nil
}

const multiplierScale = 1_000_000_000_000
