// src/index.ts
import {
  BlockTree,
  type BlockHeader,
  type ReorgResult
} from './blockTree.js';

import {
  ReorgEngine,
  type ReorgEngineOptions,
  type InvariantReport,
  type BlockAdmissionResult,
  type AlertEventType,
  type AlertEvent,
  type SubscriptionState,
  type EngineBlockResult,
  type EngineBatchResult,
  type EngineSnapshot
} from './reorgEngine.js';

import { FileStateWal, type StateWal } from './stateWal.js';

export {
  BlockTree,
  ReorgEngine,
  FileStateWal
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
  InvariantReport,
  BlockAdmissionResult,
  StateWal
};
