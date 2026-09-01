// src/index.ts
import {
  CryptoEnvelopeManager,
  obterEstadoQuarentenaBitmask,
  type KeyMetadata,
  type EncryptedEnvelope,
  type DecryptedMessage
} from './cryptoEnvelope.js';

export {
  CryptoEnvelopeManager,
  obterEstadoQuarentenaBitmask
};

export type {
  KeyMetadata,
  EncryptedEnvelope,
  DecryptedMessage
};
