import type { Address } from 'viem';
import type { Edge, Graph, ArbitrageOpportunity, SwapStep, ChainId } from '../types/index.js';
import { DexType } from '../types/index.js';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import Decimal from 'decimal.js';

// Configure Decimal.js for high precision
Decimal.set({ precision: 50, rounding: Decimal.ROUND_DOWN });

/**
 * Graph-based arbitrage detector using Bellman-Ford algorithm
 * Detects negative cycles which represent profitable arbitrage opportunities
 */
export class ArbitrageDetector {
  private graph: Graph;
  private chainId: ChainId;
  private minProfitBps: number;

  constructor(chainId: ChainId, minProfitBps: number = 10) {
    this.chainId = chainId;
    this.minProfitBps = minProfitBps;
    this.graph = {
      vertices: new Set(),
      edges: new Map(),
    };
  }

  /**
   * Add or update an edge in the graph
   * Weight is calculated as -ln(exchange_rate) to convert multiplication to addition
   */
  addEdge(edge: Edge): void {
    this.graph.vertices.add(edge.from);
    this.graph.vertices.add(edge.to);

    const edges = this.graph.edges.get(edge.from) || [];
    
    // Remove existing edge for same pair if exists
    const existingIndex = edges.findIndex(
      e => e.to === edge.to && e.pool === edge.pool
    );
    if (existingIndex !== -1) {
      edges.splice(existingIndex, 1);
    }
    
    edges.push(edge);
    this.graph.edges.set(edge.from, edges);
  }

  /**
   * Calculate exchange rate from reserves
   * Accounts for DEX fees
   */
  static calculateRate(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
    feeBps: number
  ): { amountOut: bigint; rate: number } {
    const feeMultiplier = 10000n - BigInt(feeBps);
    const amountInWithFee = amountIn * feeMultiplier;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 10000n + amountInWithFee;
    const amountOut = numerator / denominator;
    
    const rate = Number(amountOut) / Number(amountIn);
    return { amountOut, rate };
  }

  /**
   * Calculate edge weight for Bellman-Ford
   * Using -ln(rate) so that negative cycles = profitable arbitrage
   */
  static calculateWeight(rate: number): number {
    if (rate <= 0) return Infinity;
    return -Math.log(rate);
  }

  /**
   * Run Bellman-Ford algorithm to find negative cycles (arbitrage opportunities)
   */
  findArbitrageOpportunities(
    sourceToken: Address,
    inputAmount: bigint
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const vertices = Array.from(this.graph.vertices);
    const n = vertices.length;
    
    if (n === 0) return opportunities;

    // Initialize distances
    const distance: Map<Address, number> = new Map();
    const predecessor: Map<Address, Edge | null> = new Map();
    
    for (const v of vertices) {
      distance.set(v, Infinity);
      predecessor.set(v, null);
    }
    distance.set(sourceToken, 0);

    // Relax edges V-1 times
    for (let i = 0; i < n - 1; i++) {
      let updated = false;
      
      for (const [from, edges] of this.graph.edges) {
        const distFrom = distance.get(from);
        if (distFrom === undefined || distFrom === Infinity) continue;

        for (const edge of edges) {
          const newDist = distFrom + edge.weight;
          const distTo = distance.get(edge.to);
          
          if (distTo !== undefined && newDist < distTo) {
            distance.set(edge.to, newDist);
            predecessor.set(edge.to, edge);
            updated = true;
          }
        }
      }
      
      if (!updated) break;
    }

    // Check for negative cycles (one more iteration)
    const negativeCycleVertices = new Set<Address>();
    
    for (const [from, edges] of this.graph.edges) {
      const distFrom = distance.get(from);
      if (distFrom === undefined || distFrom === Infinity) continue;

      for (const edge of edges) {
        const distTo = distance.get(edge.to);
        if (distTo !== undefined && distFrom + edge.weight < distTo) {
          // Found negative cycle - trace it back
          negativeCycleVertices.add(edge.to);
        }
      }
    }

    // Extract cycles and calculate profits
    for (const startVertex of negativeCycleVertices) {
      const cycle = this.extractCycle(startVertex, predecessor);
      if (cycle.length > 0 && cycle[0]?.from === sourceToken) {
        const opportunity = this.buildOpportunity(cycle, inputAmount);
        if (opportunity && opportunity.expectedProfit > 0n) {
          opportunities.push(opportunity);
        }
      }
    }

    // Also check direct 2-hop and 3-hop cycles from source
    const directCycles = this.findDirectCycles(sourceToken, 3);
    for (const cycle of directCycles) {
      const opportunity = this.buildOpportunity(cycle, inputAmount);
      if (opportunity && opportunity.expectedProfit > 0n) {
        // Avoid duplicates
        const isDuplicate = opportunities.some(
          o => o.path.length === opportunity.path.length &&
               o.path.every((step, i) => step.pool === opportunity.path[i]?.pool)
        );
        if (!isDuplicate) {
          opportunities.push(opportunity);
        }
      }
    }

    // Sort by profit
    return opportunities.sort((a, b) => 
      Number(b.expectedProfit - a.expectedProfit)
    );
  }

  /**
   * Find direct cycles of specified max length starting from source
   */
  private findDirectCycles(source: Address, maxHops: number): Edge[][] {
    const cycles: Edge[][] = [];
    
    const dfs = (current: Address, path: Edge[], visited: Set<string>) => {
      if (path.length > maxHops) return;
      
      const edges = this.graph.edges.get(current) || [];
      
      for (const edge of edges) {
        const edgeKey = `${edge.from}-${edge.to}-${edge.pool}`;
        
        if (edge.to === source && path.length >= 2) {
          // Found a cycle back to source
          cycles.push([...path, edge]);
        } else if (!visited.has(edgeKey) && path.length < maxHops) {
          visited.add(edgeKey);
          dfs(edge.to, [...path, edge], visited);
          visited.delete(edgeKey);
        }
      }
    };

    dfs(source, [], new Set());
    return cycles;
  }

  /**
   * Extract cycle from predecessor map
   */
  private extractCycle(
    start: Address,
    predecessor: Map<Address, Edge | null>
  ): Edge[] {
    const cycle: Edge[] = [];
    const visited = new Set<Address>();
    let current = start;

    // Go back to find the cycle
    while (!visited.has(current)) {
      visited.add(current);
      const edge = predecessor.get(current);
      if (!edge) break;
      cycle.unshift(edge);
      current = edge.from;
    }

    // Find where the cycle actually starts
    const cycleStart = current;
    const startIndex = cycle.findIndex(e => e.from === cycleStart);
    
    return startIndex >= 0 ? cycle.slice(startIndex) : cycle;
  }

  /**
   * Build ArbitrageOpportunity from a cycle of edges
   */
  private buildOpportunity(
    cycle: Edge[],
    inputAmount: bigint
  ): ArbitrageOpportunity | null {
    if (cycle.length === 0) return null;

    const swapSteps: SwapStep[] = [];
    let currentAmount = inputAmount;

    for (const edge of cycle) {
      // Calculate output for this step
      const isToken0ToToken1 = edge.from.toLowerCase() < edge.to.toLowerCase();
      const reserveIn = isToken0ToToken1 ? edge.reserve0 : edge.reserve1;
      const reserveOut = isToken0ToToken1 ? edge.reserve1 : edge.reserve0;

      const { amountOut } = ArbitrageDetector.calculateRate(
        reserveIn,
        reserveOut,
        currentAmount,
        edge.fee
      );

      // Encode swap data based on DEX type
      let data: `0x${string}`;
      if (edge.dexType === DexType.UniswapV3) {
        data = encodeAbiParameters(
          parseAbiParameters('uint24'),
          [edge.fee]
        );
      } else if (edge.dexType === DexType.Velodrome) {
        const stable = edge.fee < 10; // Low fee = stable pool
        data = encodeAbiParameters(
          parseAbiParameters('bool'),
          [stable]
        );
      } else {
        data = '0x';
      }

      swapSteps.push({
        router: edge.router,
        tokenIn: edge.from,
        tokenOut: edge.to,
        amountIn: currentAmount,
        expectedAmountOut: amountOut,
        pool: edge.pool,
        dexType: edge.dexType,
        data,
      });

      currentAmount = amountOut;
    }

    const firstStep = cycle[0];
    if (!firstStep) return null;
    
    const expectedProfit = currentAmount - inputAmount;
    
    // Estimate gas (rough estimate, should be simulated)
    const gasEstimate = BigInt(150000 + cycle.length * 80000);

    return {
      id: `${this.chainId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chain: this.chainId,
      path: swapSteps,
      inputToken: firstStep.from,
      inputAmount,
      expectedOutput: currentAmount,
      expectedProfit,
      profitUsd: 0, // Will be calculated with price feed
      gasEstimate,
      gasCostUsd: 0, // Will be calculated
      netProfitUsd: 0, // Will be calculated
      confidence: this.calculateConfidence(cycle, expectedProfit, inputAmount),
      timestamp: Date.now(),
      expiresAt: Date.now() + 2000, // 2 second validity
    };
  }

  /**
   * Calculate confidence score for an opportunity
   */
  private calculateConfidence(
    cycle: Edge[],
    profit: bigint,
    input: bigint
  ): number {
    // Base confidence from profit margin
    const profitBps = Number((profit * 10000n) / input);
    let confidence = Math.min(profitBps / 100, 1); // Cap at 1% = 100% confidence

    // Reduce confidence for longer paths
    confidence *= Math.pow(0.95, cycle.length - 2);

    // Reduce confidence for low liquidity pools
    for (const edge of cycle) {
      const minReserve = edge.reserve0 < edge.reserve1 ? edge.reserve0 : edge.reserve1;
      if (minReserve < 10n ** 18n) { // Less than 1 ETH equivalent
        confidence *= 0.8;
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.graph.vertices.clear();
    this.graph.edges.clear();
  }

  /**
   * Get graph statistics
   */
  getStats(): { vertices: number; edges: number } {
    let edgeCount = 0;
    for (const edges of this.graph.edges.values()) {
      edgeCount += edges.length;
    }
    return {
      vertices: this.graph.vertices.size,
      edges: edgeCount,
    };
  }
}
