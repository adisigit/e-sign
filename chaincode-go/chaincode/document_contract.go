package chaincode

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) CreatePrivateDocument(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}

	docJson, ok := transMap["doc"]
	if !ok {
		return fmt.Errorf("doc key not found in transient map")
	}

	var document PrivateDocument
	err = json.Unmarshal(docJson, &document)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
	}

	existing, err := ctx.GetStub().GetPrivateData(document.Collection, document.ID)
	if err != nil {
		return fmt.Errorf("failed to read from collection: %v", err)
	}
	if existing != nil {
		return fmt.Errorf("the private document %s already exists in collection %s", document.ID, document.Collection)
	}

	finalDocJson, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("failed to marshal final document JSON: %v", err)
	}

	err = ctx.GetStub().PutPrivateData(document.Collection, document.ID, finalDocJson)
	if err != nil {
		return fmt.Errorf("failed to put private document: %v", err)
	}

	collectionLog := document.Collection + "Log"

	log := PrivateLogDocument{
		CollectionLog: collectionLog,
		ID:            uuid.New().String(),
		DocumentID:    document.ID,
		ActorID:       document.OwnerID,
		ActorName:     document.OwnerName,
		Action:        "UPLOAD_DOCUMENT",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}

	logJson, err := json.Marshal(log)
	if err != nil {
		return fmt.Errorf("failed to marshal log JSON: %v", err)
	}

	return ctx.GetStub().PutPrivateData(collectionLog, log.ID, logJson)
}

func (s *SmartContract) ReadAllDocumentByOrg(ctx contractapi.TransactionContextInterface, collection string) ([]*PrivateDocument, error) {
	resultsIterator, err := ctx.GetStub().GetPrivateDataByRange(collection, "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get documents from %s: %v", collection, err)
	}
	defer resultsIterator.Close()

	var documents []*PrivateDocument
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		// VALIDATE HASH
		isValid, err := s.validateDataHash(ctx, collection, queryResponse.Key, queryResponse.Value)
		if err != nil {
			fmt.Printf("Warning: Hash validation error for %s: %v\n", queryResponse.Key, err)
		}
		if !isValid {
			fmt.Printf("ALERT: Data integrity compromised for document %s in collection %s\n", queryResponse.Key, collection)
			s.logCorruptionDetected(ctx, collection, queryResponse.Key)
		}

		var document PrivateDocument
		err = json.Unmarshal(queryResponse.Value, &document)
		if err != nil {
			return nil, err
		}

		documents = append(documents, &document)
	}
	return documents, nil
}
