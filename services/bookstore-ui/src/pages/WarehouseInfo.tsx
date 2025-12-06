import React, { useEffect, useState } from 'react';
import { warehouseService } from '../services/api';
import type { WarehouseInfo } from '../services/types';

type WarehouseType = 'alpha' | 'beta';

const WarehouseInfoPage: React.FC = () => {
  const [warehouse, setWarehouse] = useState<WarehouseType>('alpha');
  const [info, setInfo] = useState<WarehouseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInfo();
  }, [warehouse]);

  const loadInfo = async () => {
    try {
      setLoading(true);
      const data = await warehouseService.getInfo(warehouse);
      setInfo(data);
      setError(null);
    } catch (err) {
      setError('Failed to load warehouse info. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={styles.container}>Loading warehouse info...</div>;
  }

  if (error || !info) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error || 'No information available'}</div>
        <button onClick={loadInfo} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Warehouse Information</h1>

      <div style={styles.warehouseSelector}>
        <span style={styles.selectorLabel}>Select Warehouse:</span>
        <button
          onClick={() => setWarehouse('alpha')}
          style={warehouse === 'alpha' ? styles.warehouseButtonActive : styles.warehouseButton}
        >
          Warehouse Alpha
        </button>
        <button
          onClick={() => setWarehouse('beta')}
          style={warehouse === 'beta' ? styles.warehouseButtonActive : styles.warehouseButton}
        >
          Warehouse Beta
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.infoSection}>
          <h2 style={styles.sectionTitle}>🏢 Warehouse Details</h2>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.label}>Name:</span>
              <span style={styles.value}>{info.name}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Status:</span>
              <span style={info.status === 'active' ? styles.statusActive : styles.statusInactive}>
                {info.status.toUpperCase()}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Registered With:</span>
              <span style={styles.value}>{info.registeredWith || 'Not registered'}</span>
            </div>
          </div>
        </div>

        <div style={styles.infoSection}>
          <h2 style={styles.sectionTitle}>📊 Connection Info</h2>
          <p style={styles.description}>
            This warehouse is {info.status === 'active' ? 'actively' : 'not'} connected to the
            Store API and ready to process shipment requests.
          </p>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '2rem',
    maxWidth: '800px',
    margin: '0 auto',
  },
  title: {
    color: '#2c3e50',
    marginBottom: '1.5rem',
  },
  warehouseSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '2rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
  },
  selectorLabel: {
    fontWeight: 600,
    color: '#2c3e50',
  },
  warehouseButton: {
    padding: '0.5rem 1.5rem',
    backgroundColor: 'white',
    color: '#2c3e50',
    border: '2px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    transition: 'all 0.2s',
  },
  warehouseButtonActive: {
    padding: '0.5rem 1.5rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: '2px solid #3498db',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '2rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  infoSection: {
    marginBottom: '2rem',
  },
  sectionTitle: {
    color: '#34495e',
    marginBottom: '1rem',
    fontSize: '1.25rem',
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  infoItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
  },
  label: {
    fontWeight: 'bold',
    color: '#7f8c8d',
  },
  value: {
    color: '#2c3e50',
  },
  statusActive: {
    color: '#27ae60',
    fontWeight: 'bold',
  },
  statusInactive: {
    color: '#e74c3c',
    fontWeight: 'bold',
  },
  description: {
    color: '#7f8c8d',
    lineHeight: 1.6,
  },
  error: {
    color: '#e74c3c',
    padding: '1rem',
    backgroundColor: '#fadbd8',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  retryButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
};

export default WarehouseInfoPage;
