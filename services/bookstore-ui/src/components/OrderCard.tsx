import React from 'react';
import type { Order } from '../services/types';

interface OrderCardProps {
  order: Order;
}

const OrderCard: React.FC<OrderCardProps> = ({ order }) => {
  const isPending = order.status === 'PENDING';

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.orderId}>Order #{order.id.slice(0, 8)}</span>
        <span style={isPending ? styles.pending : styles.shipped}>{order.status}</span>
      </div>
      <div style={styles.items}>
        {order.items.map((item) => (
          <div key={item.id} style={styles.item}>
            <span>{item.bookTitle}</span>
            <span style={styles.quantity}>Qty: {item.quantity}</span>
            <span style={styles.itemPrice}>${item.priceAtPurchase.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div style={styles.footer}>
        <span style={styles.date}>{new Date(order.createdAt).toLocaleDateString()}</span>
        <span style={styles.total}>Total: ${order.totalAmount.toFixed(2)}</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1rem',
    backgroundColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '1rem',
    paddingBottom: '0.5rem',
    borderBottom: '1px solid #ecf0f1',
  },
  orderId: {
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  pending: {
    color: '#f39c12',
    fontWeight: 'bold',
    fontSize: '0.875rem',
  },
  shipped: {
    color: '#27ae60',
    fontWeight: 'bold',
    fontSize: '0.875rem',
  },
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
  },
  quantity: {
    fontSize: '0.875rem',
    color: '#7f8c8d',
  },
  itemPrice: {
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '0.5rem',
    borderTop: '1px solid #ecf0f1',
  },
  date: {
    fontSize: '0.875rem',
    color: '#7f8c8d',
  },
  total: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#27ae60',
  },
};

export default OrderCard;
