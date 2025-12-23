package chaincode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) validateDataHash(ctx contractapi.TransactionContextInterface, collection string, key string, value []byte) (bool, error) {
	currentHash := sha256.Sum256(value)
	currentHashString := hex.EncodeToString(currentHash[:])

	fmt.Printf("=== VALIDATE DEBUG ===\n")
	fmt.Printf("Collection: %s\n", collection)
	fmt.Printf("Key: %s\n", key)
	fmt.Printf("Value length: %d bytes\n", len(value))
	fmt.Printf("Value (first 100 chars): %s\n", string(value[:min(100, len(value))]))
	fmt.Printf("Calculated hash: %s\n", currentHashString)

	hashFromChain, err := ctx.GetStub().GetPrivateDataHash(collection, key)
	if err != nil {
		fmt.Printf("ERROR getting hash from chain: %v\n", err)
		return false, err
	}

	if hashFromChain == nil {
		fmt.Printf("ERROR: No hash found in blockchain\n")
		return false, fmt.Errorf("no hash found in blockchain for key: %s", key)
	}

	chainHashString := hex.EncodeToString(hashFromChain)
	fmt.Printf("Chain hash: %s\n", chainHashString)
	fmt.Printf("Hashes match: %v\n", currentHashString == chainHashString)
	fmt.Printf("===================\n")

	return currentHashString == chainHashString, nil
}

// func (s *SmartContract) validateDataHash(ctx contractapi.TransactionContextInterface, collection string, key string, value []byte) (bool, error) {
// 	currentHash := sha256.Sum256(value)

// 	hashFromChain, err := ctx.GetStub().GetPrivateDataHash(collection, key)
// 	if err != nil {
// 		return false, err
// 	}

// 	if hashFromChain == nil {
// 		return false, fmt.Errorf("no hash found in blockchain")
// 	}

// 	return hex.EncodeToString(currentHash[:]) == hex.EncodeToString(hashFromChain), nil
// }

func (s *SmartContract) logCorruptionDetected(ctx contractapi.TransactionContextInterface, collection string, documentID string) {
	collectionLog := collection + "Log"

	log := PrivateLogDocument{
		CollectionLog: collectionLog,
		ID:            uuid.New().String(),
		DocumentID:    documentID,
		ActorID:       "SYSTEM",
		ActorName:     "Integrity Monitor",
		Action:        "CORRUPTION_DETECTED",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}

	logJson, err := json.Marshal(log)
	if err != nil {
		return
	}

	ctx.GetStub().PutPrivateData(collectionLog, log.ID, logJson)
}
