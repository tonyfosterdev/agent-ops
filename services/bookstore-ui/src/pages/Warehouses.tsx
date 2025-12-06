import React, { useEffect, useState } from 'react';
import HealthBadge from '../components/HealthBadge';
import { storeService } from '../services/api';
import type { Warehouse } from '../services/types';

const Warehouses: React.FC = () => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWarehouses();
    const interval = setInterval(loadWarehouses, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      const data = await storeService.getWarehouses();
      setWarehouses(data);
      setError(null);
    } catch (err) {
      setError('Failed to load warehouses. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && warehouses.length === 0) {
    return <div style={styles.container}>Loading warehouses...</div>;
  }

  if (error && warehouses.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <button onClick={loadWarehouses} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Warehouse Registry</h1>
        <button onClick={loadWarehouses} style={styles.refreshButton}>
          🔄 Refresh
        </button>
      </div>
      <div style={styles.grid}>
        {warehouses.map((warehouse) => (
          <div key={warehouse.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.warehouseName}>{warehouse.name}</h3>
              <HealthBadge status={warehouse.status} />
            </div>
            <div style={styles.cardBody}>
              <p style={styles.url}>
                <strong>URL:</strong> {warehouse.url}
              </p>
              <p style={styles.lastSeen}>
                <strong>Last Seen:</strong>{' '}
                {new Date(warehouse.lastSeen).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
      {warehouses.length === 0 && (
        <div style={styles.empty}>
          <p>No warehouses registered yet.</p>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '2rem',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem',
  },
  title: {
    color: '#2c3e50',
    margin: 0,
  },
  refreshButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1.5rem',
    backgroundColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid #ecf0f1',
  },
  warehouseName: {
    margin: 0,
    color: '#2c3e50',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  url: {
    fontSize: '0.9rem',
    color: '#7f8c8d',
    wordBreak: 'break-all',
  },
  lastSeen: {
    fontSize: '0.875rem',
    color: '#95a5a6',
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
  empty: {
    textAlign: 'center',
    padding: '4rem 2rem',
    color: '#7f8c8d',
  },
};

export default Warehouses;
