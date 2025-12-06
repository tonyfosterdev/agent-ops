// User Roles
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  STORE_ADMIN = 'STORE_ADMIN',
  WAREHOUSE_STAFF = 'WAREHOUSE_STAFF',
}

// Order States
export enum OrderStatus {
  PENDING = 'PENDING',
  SHIPPED = 'SHIPPED',
}

// Warehouse Health Status
export enum WarehouseStatus {
  HEALTHY = 'HEALTHY',
  OFFLINE = 'OFFLINE',
}

// API Request/Response Types
export interface RegisterWarehouseRequest {
  name: string;
  url: string;
  internalUrl: string;
}

export interface ShipmentInstructionRequest {
  orderId: string;
  items: {
    bookId: string;
    isbn: string;
    quantity: number;
  }[];
}

export interface ShipmentConfirmationResponse {
  orderId: string;
  warehouseName: string;
  shipped: boolean;
  shippedAt: Date;
}

export interface StockQueryResponse {
  bookId: string;
  isbn: string;
  quantity: number;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'offline';
  timestamp: Date;
}
