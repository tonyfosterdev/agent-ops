export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string;
  price: number;
  genre: string;
  publishedYear: number;
  availableStock: number;
}

export interface Order {
  id: string;
  status: 'PENDING' | 'SHIPPED';
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

export interface OrderItem {
  id: string;
  bookTitle: string;
  quantity: number;
  priceAtPurchase: number;
}

export interface Warehouse {
  id: string;
  name: string;
  url: string;
  status: 'HEALTHY' | 'OFFLINE';
  lastSeen: string;
}

export interface InventoryItem {
  bookId: string;
  isbn: string;
  title: string;
  author: string;
  quantity: number;
}

export interface WarehouseInfo {
  name: string;
  status: string;
  registeredWith: string;
}
