import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  RefreshCw,
  Settings,
  BarChart3,
  Wallet,
  Globe,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';

// Types
interface BotStatus {
  isRunning: boolean;
  isPaused: boolean;
  currentChains: number[];
  totalProfit: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  address: string;
  balances: Record<number, string>;
  uptime: number;
  lastTradeTime?: number;
}

interface Trade {
  id: string;
  chain: number;
  timestamp: number;
  txHash: string;
  inputToken: string;
  inputAmount: string;
  outputAmount: string;
  profit: string;
  profitUsd: number;
  gasUsed: string;
  gasCostUsd: number;
  path: string[];
  success: boolean;
  error?: string;
}

interface Opportunity {
  id: string;
  chain: number;
  inputToken: string;
  inputAmount: string;
  expectedProfit: string;
  profitUsd: number;
  netProfitUsd: number;
  confidence: number;
  timestamp: number;
  expiresAt: number;
}

interface Pool {
  pool: string;
  dex: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  fee: number;
  timestamp: number;
}

// Chain names
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  8453: 'Base',
  10: 'Optimism',
};

const CHAIN_COLORS: Record<number, string> = {
  1: '#627EEA',
  42161: '#28A0F0',
  8453: '#0052FF',
  10: '#FF0420',
};

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Custom hooks
function useApi<T>(endpoint: string, interval?: number): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refresh: fetchData };
}

// Utility functions
function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatNumber(value: string | number, decimals = 4): string {
  const num = typeof value === 'string' ? parseFloat(value) / 1e18 : value;
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Components
function StatCard({ title, value, subValue, icon: Icon, trend, color = 'emerald' }: {
  title: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | null;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `var(--${color}-glow)` }}>
        <Icon size={20} style={{ color: `var(--${color})` }} />
      </div>
      <div className="stat-content">
        <span className="stat-title">{title}</span>
        <div className="stat-value-row">
          <span className="stat-value">{value}</span>
          {trend && (
            <span className={`stat-trend ${trend}`}>
              {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            </span>
          )}
        </div>
        {subValue && <span className="stat-sub">{subValue}</span>}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const chainName = CHAIN_NAMES[trade.chain] || `Chain ${trade.chain}`;
  const chainColor = CHAIN_COLORS[trade.chain] || '#888';

  return (
    <div className={`trade-row ${trade.success ? 'success' : 'failed'}`}>
      <div className="trade-status">
        {trade.success ? (
          <CheckCircle size={18} className="text-emerald" />
        ) : (
          <XCircle size={18} className="text-red" />
        )}
      </div>
      <div className="trade-chain" style={{ borderColor: chainColor }}>
        {chainName}
      </div>
      <div className="trade-profit">
        <span className={trade.success ? 'text-emerald' : 'text-red'}>
          {trade.success ? '+' : ''}{formatUsd(trade.profitUsd)}
        </span>
        <span className="trade-gas">Gas: {formatUsd(trade.gasCostUsd)}</span>
      </div>
      <div className="trade-time">
        {formatDistanceToNow(trade.timestamp, { addSuffix: true })}
      </div>
      <a
        href={`https://etherscan.io/tx/${trade.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="trade-link"
      >
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const chainName = CHAIN_NAMES[opportunity.chain] || `Chain ${opportunity.chain}`;
  const chainColor = CHAIN_COLORS[opportunity.chain] || '#888';
  const timeLeft = Math.max(0, opportunity.expiresAt - Date.now());

  return (
    <div className="opportunity-card">
      <div className="opportunity-header">
        <span className="opportunity-chain" style={{ borderColor: chainColor }}>
          {chainName}
        </span>
        <span className="opportunity-confidence">
          {(opportunity.confidence * 100).toFixed(0)}% conf
        </span>
      </div>
      <div className="opportunity-profit">
        <span className="opportunity-label">Net Profit</span>
        <span className="opportunity-value text-emerald">
          {formatUsd(opportunity.netProfitUsd)}
        </span>
      </div>
      <div className="opportunity-footer">
        <span className="opportunity-timer">
          <Clock size={12} />
          {timeLeft > 0 ? `${(timeLeft / 1000).toFixed(1)}s` : 'Expired'}
        </span>
        <ChevronRight size={16} />
      </div>
    </div>
  );
}

function ProfitChart({ trades }: { trades: Trade[] }) {
  // Aggregate by hour
  const chartData = React.useMemo(() => {
    const hourlyData: Record<string, { time: string; profit: number; count: number }> = {};
    
    trades.filter(t => t.success).forEach(trade => {
      const hour = new Date(trade.timestamp).toISOString().slice(0, 13);
      if (!hourlyData[hour]) {
        hourlyData[hour] = { time: hour, profit: 0, count: 0 };
      }
      hourlyData[hour].profit += trade.profitUsd;
      hourlyData[hour].count += 1;
    });

    return Object.values(hourlyData)
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-24);
  }, [trades]);

  if (chartData.length === 0) {
    return (
      <div className="chart-empty">
        <BarChart3 size={40} />
        <span>No trade data yet</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit' })}
          stroke="#4b5563"
          fontSize={10}
        />
        <YAxis
          tickFormatter={(v) => `$${v}`}
          stroke="#4b5563"
          fontSize={10}
          width={50}
        />
        <Tooltip
          contentStyle={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '8px',
          }}
          formatter={(value: number) => [formatUsd(value), 'Profit']}
          labelFormatter={(label) => new Date(label).toLocaleString()}
        />
        <Area
          type="monotone"
          dataKey="profit"
          stroke="#10b981"
          fill="url(#profitGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Main Dashboard
export default function Dashboard() {
  const { data: status, loading: statusLoading, refresh: refreshStatus } = useApi<BotStatus>('/api/status', 2000);
  const { data: trades, loading: tradesLoading, refresh: refreshTrades } = useApi<Trade[]>('/api/trades', 5000);
  const { data: opportunities } = useApi<Opportunity[]>('/api/opportunities', 1000);

  const handlePause = async () => {
    await fetch(`${API_BASE}/api/pause`, { method: 'POST' });
    refreshStatus();
  };

  const handleResume = async () => {
    await fetch(`${API_BASE}/api/resume`, { method: 'POST' });
    refreshStatus();
  };

  if (statusLoading) {
    return (
      <div className="loading-screen">
        <RefreshCw className="loading-spinner" size={40} />
        <span>Connecting to bot...</span>
      </div>
    );
  }

  const totalProfitNum = status ? parseFloat(status.totalProfit) / 1e18 : 0;
  const successRate = status && status.totalTrades > 0
    ? ((status.successfulTrades / status.totalTrades) * 100).toFixed(1)
    : '0';

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <Zap className="logo-icon" />
          <h1>Flashloan Arbitrage</h1>
          <span className={`status-badge ${status?.isRunning ? 'running' : 'stopped'}`}>
            {status?.isRunning ? (status?.isPaused ? 'Paused' : 'Running') : 'Stopped'}
          </span>
        </div>
        <div className="header-right">
          <button className="icon-btn" onClick={refreshStatus}>
            <RefreshCw size={18} />
          </button>
          {status?.isRunning && (
            <button
              className={`control-btn ${status?.isPaused ? 'resume' : 'pause'}`}
              onClick={status?.isPaused ? handleResume : handlePause}
            >
              {status?.isPaused ? <Play size={18} /> : <Pause size={18} />}
              {status?.isPaused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button className="icon-btn">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="stats-grid">
        <StatCard
          title="Total Profit"
          value={formatUsd(totalProfitNum * 3000)}
          subValue={`${formatNumber(totalProfitNum)} ETH`}
          icon={TrendingUp}
          trend={totalProfitNum > 0 ? 'up' : null}
          color="emerald"
        />
        <StatCard
          title="Total Trades"
          value={status?.totalTrades || 0}
          subValue={`${successRate}% success rate`}
          icon={Activity}
          color="blue"
        />
        <StatCard
          title="Active Chains"
          value={status?.currentChains.length || 0}
          subValue={status?.currentChains.map(c => CHAIN_NAMES[c]).join(', ')}
          icon={Globe}
          color="purple"
        />
        <StatCard
          title="Uptime"
          value={formatDuration(status?.uptime || 0)}
          subValue={status?.lastTradeTime ? `Last: ${formatDistanceToNow(status.lastTradeTime, { addSuffix: true })}` : 'No trades yet'}
          icon={Clock}
          color="amber"
        />
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Left Column */}
        <div className="content-left">
          {/* Profit Chart */}
          <div className="card">
            <div className="card-header">
              <h2>Profit Over Time</h2>
              <span className="card-badge">24h</span>
            </div>
            <div className="card-body">
              <ProfitChart trades={trades || []} />
            </div>
          </div>

          {/* Trade History */}
          <div className="card">
            <div className="card-header">
              <h2>Recent Trades</h2>
              <span className="trade-count">{trades?.length || 0} trades</span>
            </div>
            <div className="card-body trades-list">
              {trades && trades.length > 0 ? (
                trades.slice(0, 10).map(trade => (
                  <TradeRow key={trade.id} trade={trade} />
                ))
              ) : (
                <div className="empty-state">
                  <Activity size={32} />
                  <span>No trades yet</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="content-right">
          {/* Wallet */}
          <div className="card">
            <div className="card-header">
              <h2>Wallet</h2>
              <Wallet size={18} />
            </div>
            <div className="card-body">
              <div className="wallet-address">
                <span className="address-label">Address</span>
                <code className="address-value">{formatAddress(status?.address || '')}</code>
              </div>
              <div className="wallet-balances">
                {status?.balances && Object.entries(status.balances).map(([chainId, balance]) => (
                  <div key={chainId} className="balance-row">
                    <span className="balance-chain" style={{ borderColor: CHAIN_COLORS[Number(chainId)] }}>
                      {CHAIN_NAMES[Number(chainId)]}
                    </span>
                    <span className="balance-value">
                      {formatNumber(balance)} ETH
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live Opportunities */}
          <div className="card">
            <div className="card-header">
              <h2>Live Opportunities</h2>
              <span className="live-dot"></span>
            </div>
            <div className="card-body opportunities-list">
              {opportunities && opportunities.length > 0 ? (
                opportunities.slice(0, 5).map(opp => (
                  <OpportunityCard key={opp.id} opportunity={opp} />
                ))
              ) : (
                <div className="empty-state">
                  <AlertTriangle size={32} />
                  <span>Scanning for opportunities...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
