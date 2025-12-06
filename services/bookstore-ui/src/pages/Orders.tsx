import React, { useEffect, useState } from 'react';
import OrderCard from '../components/OrderCard';
import { storeService } from '../services/api';
import type { Order } from '../services/types';

const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await storeService.getOrders();
      setOrders(data);
      setError(null);
    } catch (err) {
      setError('Failed to load orders. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={styles.container}>Loading orders...</div>;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <button onClick={loadOrders} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <h2>No orders yet</h2>
          <p>Start shopping to see your orders here!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>My Orders</h1>
      <div style={styles.list}>
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
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
    marginBottom: '2rem',
    color: '#2c3e50',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
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

export default Orders;
