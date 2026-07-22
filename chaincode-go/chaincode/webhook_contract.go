package chaincode

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) CreatePrivateLogDocumentWebhook(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}
	logJson, ok := transMap["log"]
	if !ok {
		return fmt.Errorf("log key not found in transient map")
	}

	var log PrivateLogDocumentWebhook
	err = json.Unmarshal(logJson, &log)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
	}

	log.ID = uuid.New().String()
	log.Timestamp = time.Now().UTC().Format(time.RFC3339)

	serializedLog, err := json.Marshal(log)
	if err != nil {
		return fmt.Errorf(
			"failed to serialize final log: %w",
			err,
		)
	}

	canonicalLog, err := canonicalizeJSON(serializedLog)
	if err != nil {
		return fmt.Errorf(
			"failed to canonicalize final log: %w",
			err,
		)
	}

	return ctx.GetStub().PutPrivateData(log.CollectionLog, log.ID, canonicalLog)
}

func (s *SmartContract) CreatePrivateDataWebhook(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}
	webhookJSON, ok := transMap["webhook"]
	if !ok {
		return fmt.Errorf("webhook key not found in transient map")
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(webhookJSON, &payload); err != nil {
		return fmt.Errorf("failed to unmarshal webhook json: %v", err)
	}

	documentWebhook := PrivateDocumentWebhook{
		Collection:           payload["collection"].(string),
		ID:                   payload["id"].(string),
		DocumentCategoryCode: payload["documentCategoryCode"].(string),
		Name:                 payload["name"].(string),
		Description:          payload["description"].(string),
		File:                 payload["file"].(string),
		Timestamp:            time.Now().UTC().Format(time.RFC3339),
	}
	serializedDocument, err := json.Marshal(documentWebhook)
	if err != nil {
		return fmt.Errorf(
			"failed to serialize private document: %w",
			err,
		)
	}

	canonicalDocument, err := canonicalizeJSON(serializedDocument)
	if err != nil {
		return fmt.Errorf(
			"failed to canonicalize private document: %w",
			err,
		)
	}
	if err := ensureDocumentDoesNotExist(
		ctx,
		documentWebhook.Collection,
		documentWebhook.ID,
	); err != nil {
		return err
	}
	err = ctx.GetStub().PutPrivateData(documentWebhook.Collection, documentWebhook.ID, canonicalDocument)
	if err != nil {
		return fmt.Errorf("failed to put private document webhook: %v", err)
	}

	collectionLog := documentWebhook.Collection + "Log"

	recipients := payload["recipients"].([]interface{})
	for _, recipient := range recipients {
		recipientMap := recipient.(map[string]interface{})
		logDocumentWebhook := PrivateLogDocumentWebhook{
			CollectionLog:     collectionLog,
			ID:                uuid.New().String(),
			DocumentID:        documentWebhook.ID,
			UserID:            recipientMap["userId"].(string),
			Name:              recipientMap["name"].(string),
			UserRoleCode:      recipientMap["userRoleCode"].(string),
			RecipientRoleCode: recipientMap["recipientRoleCode"].(string),
			Timestamp:         time.Now().UTC().Format(time.RFC3339),
		}

		serializedLog, err := json.Marshal(logDocumentWebhook)
		if err != nil {
			return fmt.Errorf(
				"failed to serialize private log: %w",
				err,
			)
		}

		canonicalLog, err := canonicalizeJSON(serializedLog)
		if err != nil {
			return fmt.Errorf(
				"failed to canonicalize private log: %w",
				err,
			)
		}

		err = ctx.GetStub().PutPrivateData(collectionLog, logDocumentWebhook.ID, canonicalLog)
		if err != nil {
			return fmt.Errorf("failed to put private log document webhook: %v", err)
		}
	}

	return nil
}

func (s *SmartContract) ReadAllLogByDocumentIDWebhook(ctx contractapi.TransactionContextInterface, collectionLog string, documentID string) ([]*PrivateLogDocumentWebhook, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collectionLog, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get log documents with id %s from %s: %v", documentID, collectionLog, err)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf("log document not found: %s", documentID)
	}

	var logs []*PrivateLogDocumentWebhook
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var log PrivateLogDocumentWebhook
		err = json.Unmarshal(queryResponse.Value, &log)
		if err != nil {
			return nil, err
		}

		logs = append(logs, &log)
	}

	return logs, nil
}
