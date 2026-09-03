// src/index.ts
import {
  BlockTree,
  type BlockHeader,
  type ReorgResult
} from './blockTree.js';

import {
  ReorgEngine,
  type AlertEventType,
  type AlertEvent,
  type SubscriptionState,
  type EngineBlockResult,
  type EngineBatchResult,
  type EngineSnapshot,
  type ReorgEngineOptions,
  type InvariantViolation,
  type InvariantReport,
  type BlockAdmissionResult
} from './reorgEngine.js';

export {
  BlockTree,
  ReorgEngine
};

export type {
  BlockHeader,
  ReorgResult,
  AlertEventType,
  AlertEvent,
  SubscriptionState,
  EngineBlockResult,
  EngineBatchResult,
  EngineSnapshot,
  ReorgEngineOptions,
  InvariantViolation,
  InvariantReport,
  BlockAdmissionResult
};
