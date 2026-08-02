/**
 * L20 — In-Memory Distributed Consensus Engine & State Machine (Raft Protocol)
 * Term management, leader election, log replication with commitIndex, state machine snapshots, and role transitions.
 */

export type NodeRole = "follower" | "candidate" | "leader";

export interface LogEntry {
  term: number;
  index: number;
  command: string;
}

export interface ConsensusState {
  currentTerm: number;
  votedFor: string | null;
  role: NodeRole;
  commitIndex: number;
  lastApplied: number;
}

export class ConsensusEngine {
  private nodeId: string;
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private role: NodeRole = "follower";
  private log: LogEntry[] = [];
  private commitIndex: number = 0;
  private lastApplied: number = 0;
  private stateMachine: Map<string, string> = new Map();
  private peers: Set<string> = new Set();

  constructor(nodeId: string, initialPeers: string[] = []) {
    this.nodeId = nodeId;
    initialPeers.forEach((p) => this.peers.add(p));
  }

  public getNodeId(): string {
    return this.nodeId;
  }

  public getState(): ConsensusState {
    return {
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      role: this.role,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied
    };
  }

  public getRole(): NodeRole {
    return this.role;
  }

  public getCurrentTerm(): number {
    return this.currentTerm;
  }

  public addPeer(peerId: string): void {
    if (peerId !== this.nodeId) {
      this.peers.add(peerId);
    }
  }

  public startElection(): boolean {
    this.currentTerm++;
    this.role = "candidate";
    this.votedFor = this.nodeId;

    let votesGranted = 1; // Vote for self
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;

    for (const peer of this.peers) {
      // Simulate vote request RPC
      if (peer) {
        votesGranted++;
      }
    }

    if (votesGranted >= majority) {
      this.role = "leader";
      return true;
    }

    this.role = "follower";
    return false;
  }

  public submitCommand(command: string): boolean {
    if (this.role !== "leader") {
      return false;
    }

    const index = this.log.length + 1;
    const entry: LogEntry = {
      term: this.currentTerm,
      index,
      command
    };

    this.log.push(entry);
    this.replicateAndCommit(entry);
    return true;
  }

  private replicateAndCommit(entry: LogEntry): void {
    // In-memory commit algorithm
    this.commitIndex = entry.index;
    this.applyLogToStateMachine();
  }

  private applyLogToStateMachine(): void {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied - 1];
      if (entry) {
        const parts = entry.command.split("=");
        if (parts.length === 2 && parts[0] && parts[1]) {
          this.stateMachine.set(parts[0].trim(), parts[1].trim());
        }
      }
    }
  }

  public getValue(key: string): string | undefined {
    return this.stateMachine.get(key);
  }

  public createSnapshot(): { term: number; index: number; state: Record<string, string> } {
    const snapshotState: Record<string, string> = {};
    this.stateMachine.forEach((val, key) => {
      snapshotState[key] = val;
    });

    return {
      term: this.currentTerm,
      index: this.lastApplied,
      state: snapshotState
    };
  }
}

export async function submeterComandoConsenso(
  engine: ConsensusEngine,
  command: string
): Promise<boolean> {
  return engine.submitCommand(command);
}
