import axios from 'axios';
import type { Book, Order, Warehouse, InventoryItem, WarehouseInfo } from './types';

const STORE_API = import.meta.env.VITE_STORE_API_URL || '/api/store';
const WAREHOUSE_ALPHA_API = import.meta.env.VITE_WAREHOUSE_ALPHA_URL || '/api/warehouses/alpha';
const WAREHOUSE_BETA_API = import.meta.env.VITE_WAREHOUSE_BETA_URL || '/api/warehouses/beta';

// Create axios instances
const storeApi = axios.create({
  baseURL: STORE_API,
  headers: {
    'Content-Type': 'application/json',
  },
});

const createWarehouseApi = (baseURL: string) => axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Current auth credentials
let currentAuth: { email: string; password: string } | null = null;

// Set current user credentials
export const setAuthCredentials = (email: string | null, password: string | null) => {
  if (email && password) {
    currentAuth = { email, password };
  } else {
    currentAuth = null;
  }
};

// Add auth header (basic auth for demo)
const getAuthHeader = () => {
  if (!currentAuth) {
    return undefined;
  }
  const token = btoa(`${currentAuth.email}:${currentAuth.password}`);
  return `Basic ${token}`;
};

// Store API calls
export const storeService = {
  async getBooks(): Promise<Book[]> {
    const response = await storeApi.get('/books');
    return response.data;
  },

  async createOrder(bookId: string, quantity: number): Promise<Order> {
    const authHeader = getAuthHeader();
    const response = await storeApi.post(
      '/orders',
      { items: [{ bookId, quantity }] },
      {
        headers: authHeader ? { Authorization: authHeader } : {},
      }
    );
    return response.data;
  },

  async getOrders(): Promise<Order[]> {
    const authHeader = getAuthHeader();
    const response = await storeApi.get('/orders', {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    return response.data;
  },

  async getWarehouses(): Promise<Warehouse[]> {
    const authHeader = getAuthHeader();
    const response = await storeApi.get('/warehouses', {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    return response.data;
  },
};

// Warehouse API calls
export const warehouseService = {
  getWarehouseApi(warehouse: 'alpha' | 'beta') {
    const baseURL = warehouse === 'alpha' ? WAREHOUSE_ALPHA_API : WAREHOUSE_BETA_API;
    return createWarehouseApi(baseURL);
  },

  async getInventory(warehouse: 'alpha' | 'beta'): Promise<InventoryItem[]> {
    const api = this.getWarehouseApi(warehouse);
    const response = await api.get('/inventory');
    return response.data;
  },

  async updateInventory(warehouse: 'alpha' | 'beta', bookId: string, quantity: number): Promise<InventoryItem> {
    const api = this.getWarehouseApi(warehouse);
    const authHeader = getAuthHeader();
    const response = await api.patch(
      `/inventory/${bookId}`,
      { quantity },
      {
        headers: authHeader ? { Authorization: authHeader } : {},
      }
    );
    return response.data;
  },

  async getInfo(warehouse: 'alpha' | 'beta'): Promise<WarehouseInfo> {
    const api = this.getWarehouseApi(warehouse);
    const response = await api.get('/info');
    return response.data;
  },
};
