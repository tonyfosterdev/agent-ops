import React, { useEffect, useState } from 'react';
import { warehouseService } from '../services/api';
import type { InventoryItem } from '../services/types';

type WarehouseType = 'alpha' | 'beta';

const WarehouseInventory: React.FC = () => {
  console.log('[WarehouseInventory] Component rendering');

  const [warehouse, setWarehouse] = useState<WarehouseType>('alpha');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editQuantity, setEditQuantity] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    console.log('[WarehouseInventory] useEffect triggered for warehouse:', warehouse);
    loadInventory();
  }, [warehouse]);

  const loadInventory = async () => {
    try {
      setLoading(true);
      console.log('[WarehouseInventory] Loading inventory for:', warehouse);
      const data = await warehouseService.getInventory(warehouse);
      console.log('[WarehouseInventory] Loaded inventory:', data);
      setInventory(data);
      setError(null);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to load inventory. Please try again later.';
      console.error('[WarehouseInventory] Error loading inventory:', err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setEditQuantity(item.quantity);
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setEditQuantity(0);
  };

  const handleSave = async () => {
    if (!editingItem) return;

    try {
      setSaving(true);
      await warehouseService.updateInventory(warehouse, editingItem.bookId, editQuantity);

      // Update local state
      setInventory(inventory.map(item =>
        item.bookId === editingItem.bookId
          ? { ...item, quantity: editQuantity }
          : item
      ));

      setEditingItem(null);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update inventory. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  console.log('[WarehouseInventory] Render state:', { loading, error, inventoryLength: inventory.length });

  if (loading) {
    return <div style={styles.container}>Loading inventory...</div>;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <button onClick={loadInventory} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  const totalItems = inventory.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Warehouse Inventory Management</h1>

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

        <div style={styles.stats}>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Total Books:</span>
            <span style={styles.statValue}>{inventory.length}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Total Quantity:</span>
            <span style={styles.statValue}>{totalItems}</span>
          </div>
        </div>
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Author</th>
              <th style={styles.th}>ISBN</th>
              <th style={styles.th}>Quantity</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => (
              <tr key={item.bookId} style={styles.row}>
                <td style={styles.td}>{item.title}</td>
                <td style={styles.td}>{item.author}</td>
                <td style={styles.tdIsbn}>{item.isbn}</td>
                <td style={styles.tdQuantity}>
                  <span
                    style={
                      item.quantity > 10
                        ? styles.quantityHigh
                        : item.quantity > 0
                        ? styles.quantityMedium
                        : styles.quantityLow
                    }
                  >
                    {item.quantity}
                  </span>
                </td>
                <td style={styles.tdActions}>
                  <button
                    onClick={() => handleEdit(item)}
                    style={styles.editButton}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inventory.length === 0 && (
        <div style={styles.empty}>
          <p>No inventory items found in {warehouse === 'alpha' ? 'Warehouse Alpha' : 'Warehouse Beta'}.</p>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div style={styles.modalOverlay} onClick={handleCancelEdit}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Update Inventory</h2>

            <div style={styles.modalContent}>
              <div style={styles.modalField}>
                <strong>Book:</strong> {editingItem.title}
              </div>
              <div style={styles.modalField}>
                <strong>Author:</strong> {editingItem.author}
              </div>
              <div style={styles.modalField}>
                <strong>ISBN:</strong> {editingItem.isbn}
              </div>
              <div style={styles.modalField}>
                <strong>Current Quantity:</strong> {editingItem.quantity}
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>New Quantity:</label>
                <input
                  type="number"
                  min="0"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(parseInt(e.target.value) || 0)}
                  style={styles.input}
                  autoFocus
                />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={handleCancelEdit}
                style={styles.cancelButton}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                style={styles.saveButton}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
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
    marginBottom: '2rem',
  },
  title: {
    color: '#2c3e50',
    marginBottom: '1.5rem',
  },
  warehouseSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1.5rem',
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
  stats: {
    display: 'flex',
    gap: '2rem',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#7f8c8d',
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  headerRow: {
    backgroundColor: '#34495e',
    color: 'white',
  },
  th: {
    padding: '1rem',
    textAlign: 'left',
    fontWeight: 'bold',
  },
  row: {
    borderBottom: '1px solid #ecf0f1',
  },
  td: {
    padding: '1rem',
  },
  tdIsbn: {
    padding: '1rem',
    fontSize: '0.875rem',
    color: '#7f8c8d',
  },
  tdQuantity: {
    padding: '1rem',
    textAlign: 'center',
  },
  tdActions: {
    padding: '1rem',
    textAlign: 'center',
  },
  quantityHigh: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d5f4e6',
    color: '#27ae60',
    borderRadius: '12px',
    fontWeight: 'bold',
  },
  quantityMedium: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fef5e7',
    color: '#f39c12',
    borderRadius: '12px',
    fontWeight: 'bold',
  },
  quantityLow: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fadbd8',
    color: '#e74c3c',
    borderRadius: '12px',
    fontWeight: 'bold',
  },
  editButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'background-color 0.2s',
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
  // Modal styles
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '500px',
    width: '90%',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  modalTitle: {
    margin: '0 0 1.5rem 0',
    color: '#2c3e50',
  },
  modalContent: {
    marginBottom: '1.5rem',
  },
  modalField: {
    marginBottom: '0.75rem',
    color: '#2c3e50',
  },
  inputGroup: {
    marginTop: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontWeight: 600,
    color: '#2c3e50',
  },
  input: {
    padding: '0.75rem',
    border: '2px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    transition: 'border-color 0.3s',
  },
  modalActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#95a5a6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    transition: 'background-color 0.2s',
  },
  saveButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#27ae60',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    transition: 'background-color 0.2s',
  },
};

export default WarehouseInventory;
