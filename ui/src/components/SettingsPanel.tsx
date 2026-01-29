import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  AlertTriangle,
  Zap,
  DollarSign,
  Gauge,
  Shield,
  Layers,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface Config {
  minProfitUsd: number;
  maxGasPriceGwei: number;
  maxSlippageBps: number;
  dryRun: boolean;
  enabledChains: number[];
  flashbotsEnabled: boolean;
}

const CHAIN_OPTIONS = [
  { id: 1, name: 'Ethereum', color: '#627EEA' },
  { id: 42161, name: 'Arbitrum', color: '#28A0F0' },
  { id: 8453, name: 'Base', color: '#0052FF' },
  { id: 10, name: 'Optimism', color: '#FF0420' },
];

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  apiBase: string;
}

export default function SettingsPanel({ isOpen, onClose, apiBase }: SettingsPanelProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
    }
  }, [isOpen]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/api/config`);
      const data = await res.json();
      setConfig(data);
      setError(null);
    } catch (err) {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    
    try {
      setSaving(true);
      // Note: This would need a corresponding API endpoint to update config
      // For now, we just show the UI
      await new Promise(resolve => setTimeout(resolve, 500));
      onClose();
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const toggleChain = (chainId: number) => {
    if (!config) return;
    
    const chains = config.enabledChains.includes(chainId)
      ? config.enabledChains.filter(c => c !== chainId)
      : [...config.enabledChains, chainId];
    
    setConfig({ ...config, enabledChains: chains });
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>
            <Zap size={20} />
            Bot Settings
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="settings-loading">Loading configuration...</div>
        ) : error ? (
          <div className="settings-error">
            <AlertTriangle size={20} />
            {error}
          </div>
        ) : config ? (
          <div className="settings-body">
            {/* Trading Parameters */}
            <div className="settings-section">
              <h3>
                <DollarSign size={16} />
                Trading Parameters
              </h3>
              
              <div className="setting-row">
                <label>
                  <span className="setting-label">Minimum Profit (USD)</span>
                  <span className="setting-description">Only execute trades above this profit threshold</span>
                </label>
                <input
                  type="number"
                  value={config.minProfitUsd}
                  onChange={e => setConfig({ ...config, minProfitUsd: Number(e.target.value) })}
                  min={0}
                  step={1}
                />
              </div>

              <div className="setting-row">
                <label>
                  <span className="setting-label">Max Slippage (basis points)</span>
                  <span className="setting-description">100 bps = 1% slippage tolerance</span>
                </label>
                <input
                  type="number"
                  value={config.maxSlippageBps}
                  onChange={e => setConfig({ ...config, maxSlippageBps: Number(e.target.value) })}
                  min={1}
                  max={1000}
                  step={1}
                />
              </div>
            </div>

            {/* Gas Settings */}
            <div className="settings-section">
              <h3>
                <Gauge size={16} />
                Gas Settings
              </h3>
              
              <div className="setting-row">
                <label>
                  <span className="setting-label">Max Gas Price (Gwei)</span>
                  <span className="setting-description">Skip transactions when gas exceeds this</span>
                </label>
                <input
                  type="number"
                  value={config.maxGasPriceGwei}
                  onChange={e => setConfig({ ...config, maxGasPriceGwei: Number(e.target.value) })}
                  min={1}
                  step={1}
                />
              </div>
            </div>

            {/* Chain Selection */}
            <div className="settings-section">
              <h3>
                <Layers size={16} />
                Enabled Chains
              </h3>
              
              <div className="chain-grid">
                {CHAIN_OPTIONS.map(chain => (
                  <button
                    key={chain.id}
                    className={`chain-toggle ${config.enabledChains.includes(chain.id) ? 'active' : ''}`}
                    onClick={() => toggleChain(chain.id)}
                    style={{
                      borderColor: config.enabledChains.includes(chain.id) ? chain.color : undefined,
                      background: config.enabledChains.includes(chain.id) ? `${chain.color}20` : undefined,
                    }}
                  >
                    <span className="chain-dot" style={{ background: chain.color }} />
                    {chain.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Safety Features */}
            <div className="settings-section">
              <h3>
                <Shield size={16} />
                Safety Features
              </h3>
              
              <div className="setting-row toggle-row">
                <label>
                  <span className="setting-label">Dry Run Mode</span>
                  <span className="setting-description">Log trades without executing</span>
                </label>
                <button
                  className={`toggle-btn ${config.dryRun ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, dryRun: !config.dryRun })}
                >
                  {config.dryRun ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                </button>
              </div>

              <div className="setting-row toggle-row">
                <label>
                  <span className="setting-label">Flashbots (Mainnet)</span>
                  <span className="setting-description">Use Flashbots for MEV protection on Ethereum</span>
                </label>
                <button
                  className={`toggle-btn ${config.flashbotsEnabled ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, flashbotsEnabled: !config.flashbotsEnabled })}
                >
                  {config.flashbotsEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                </button>
              </div>
            </div>

            {/* Warning */}
            {!config.dryRun && (
              <div className="settings-warning">
                <AlertTriangle size={18} />
                <span>Live trading mode is enabled. Trades will be executed with real funds.</span>
              </div>
            )}
          </div>
        ) : null}

        <div className="settings-footer">
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSave} disabled={saving || loading}>
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <style>{`
        .settings-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.15s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .settings-panel {
          background: #111827;
          border: 1px solid #374151;
          border-radius: 16px;
          width: 90%;
          max-width: 520px;
          max-height: 85vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: slideUp 0.2s ease;
        }

        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid #374151;
        }

        .settings-header h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.125rem;
          font-weight: 600;
        }

        .settings-header h2 svg {
          color: #10b981;
        }

        .close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .close-btn:hover {
          background: #374151;
          color: #f9fafb;
        }

        .settings-body {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
        }

        .settings-loading,
        .settings-error {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 3rem;
          color: #9ca3af;
        }

        .settings-error {
          color: #ef4444;
        }

        .settings-section {
          margin-bottom: 1.5rem;
        }

        .settings-section h3 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
          margin-bottom: 1rem;
        }

        .setting-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          background: #1f2937;
          border-radius: 8px;
          margin-bottom: 0.5rem;
        }

        .setting-row label {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .setting-label {
          font-size: 0.875rem;
          font-weight: 500;
        }

        .setting-description {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .setting-row input {
          width: 100px;
          padding: 0.5rem 0.75rem;
          background: #111827;
          border: 1px solid #374151;
          border-radius: 6px;
          color: #f9fafb;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.875rem;
          text-align: right;
        }

        .setting-row input:focus {
          outline: none;
          border-color: #10b981;
        }

        .toggle-row .toggle-btn {
          background: none;
          border: none;
          color: #4b5563;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .toggle-row .toggle-btn.active {
          color: #10b981;
        }

        .chain-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
        }

        .chain-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #9ca3af;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .chain-toggle:hover {
          border-color: #4b5563;
        }

        .chain-toggle.active {
          color: #f9fafb;
        }

        .chain-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .settings-warning {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid #f59e0b;
          border-radius: 8px;
          color: #f59e0b;
          font-size: 0.8rem;
        }

        .settings-footer {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-top: 1px solid #374151;
        }

        .cancel-btn,
        .save-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .cancel-btn {
          background: #1f2937;
          border: 1px solid #374151;
          color: #9ca3af;
        }

        .cancel-btn:hover {
          background: #374151;
          color: #f9fafb;
        }

        .save-btn {
          background: #10b981;
          border: 1px solid #10b981;
          color: #fff;
        }

        .save-btn:hover {
          background: #059669;
        }

        .save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
