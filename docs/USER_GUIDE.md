# Agentic Store Ops - User Guide

## Welcome to the Online Bookstore!

This guide will help you get started with the Agentic Store Ops bookstore system. Whether you're a customer looking to buy books, a store administrator managing the catalog, or warehouse staff handling inventory, this guide has you covered.

## Table of Contents

- [User Roles](#user-roles)
- [Getting Started](#getting-started)
- [Customer Guide](#customer-guide)
- [Store Administrator Guide](#store-administrator-guide)
- [Warehouse Staff Guide](#warehouse-staff-guide)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

1. **Open the bookstore**: Navigate to http://localhost in your browser
2. **Login**: Use the "Quick Login" buttons on the login page:
   - Click "Customer (Alice)" for a customer account
   - Or click "Store Admin" for administrator access
3. **Start browsing**: You'll be redirected to the book catalog automatically

**Note**: The login page provides quick one-click login buttons for demo accounts. See the Customer Guide below for detailed login instructions.

---

## User Roles

### Customer
**Who**: Book buyers and readers
**What you can do**:
- Browse the book catalog
- View book details and availability
- Place orders for books
- View your order history and status
- Track shipments

**Navigation Access**: Store section (Catalog, My Orders)

### Store Administrator
**Who**: Bookstore management team
**What you can do**:
- Everything a Customer can do, plus:
- Add, edit, and remove books from the catalog
- View all customer orders (not just your own)
- Monitor warehouse health and status
- View the warehouse registry
- Trigger manual inventory reconciliation
- View warehouse inventory and info

**Navigation Access**: Store section (Catalog, My Orders, Warehouses), Warehouse section (Inventory, Info)

### Warehouse Staff
**Who**: Warehouse operations personnel
**What you can do**:
- View and manage local inventory levels
- Process shipment requests
- View shipment history
- Update stock quantities
- View warehouse information dashboard

**Navigation Access**: Store section (Catalog, My Orders), Warehouse section (Inventory, Info)

---

## Getting Started

### Accessing the System

The bookstore has multiple access points:

- **Customer & Store Admin UI**: http://localhost
- **Warehouse Alpha UI**: http://localhost (navigate to Warehouse section)
- **Warehouse Beta UI**: http://localhost (navigate to Warehouse section)

### Test Accounts

Use these credentials to explore the system:

#### Customer Account
- **Email**: `alice@customer.com`
- **Password**: `alice123`
- **Use for**: Browsing and ordering books

#### Store Administrator Account
- **Email**: `admin@bookstore.com`
- **Password**: `admin123`
- **Use for**: Managing catalog, viewing all orders, monitoring warehouses

#### Warehouse Alpha Staff
- **Email**: `staff@warehouse-alpha.com`
- **Password**: `staff123`
- **Use for**: Managing Warehouse Alpha inventory

#### Warehouse Beta Staff
- **Email**: `staff@warehouse-beta.com`
- **Password**: `staff123`
- **Use for**: Managing Warehouse Beta inventory

---

## Customer Guide

### How to Login

When you first access the bookstore at http://localhost, you'll be presented with a login page:

1. **Quick Login (Recommended for Demo)**
   - Click one of the "Quick Login" buttons:
     - **Customer (Alice)** - Regular customer account
     - **Customer (Bob)** - Another customer account
     - **Store Admin** - Administrator access
   - You'll be automatically logged in and redirected to the catalog

2. **Manual Login**
   - Enter your email address
   - Enter your password
   - Click "Sign In"

   **Test Credentials**:
   - Customer: `alice@customer.com` / `alice123`
   - Customer: `bob@customer.com` / `bob123`
   - Admin: `admin@bookstore.com` / `admin123`

3. **Stay Logged In**
   - Your session persists across browser refreshes
   - Click "Logout" in the top-right corner to sign out

### How to Browse Books

1. **Navigate to the Bookstore**
   - Open http://localhost in your browser
   - Login if prompted (see above)
   - You'll see the book catalog page

2. **View Available Books**
   - The catalog displays all available books
   - Each book shows:
     - Title and Author
     - ISBN
     - Price
     - Total Available Inventory (combined from all warehouses)

3. **Browse Without Logging In**
   - You can view the catalog without authentication
   - Login is required to place orders and view your order history

### How to Place an Order

1. **Ensure You're Logged In**
   - Check for your email address in the top-right corner
   - If not logged in, click "Login" and sign in (see "How to Login" above)

2. **Select Books**
   - Browse the catalog
   - For each book you want:
     - Click "Add to Cart" or increase the quantity
     - Specify how many copies you want

3. **Review Your Cart**
   - View your selected books
   - Check quantities and prices
   - See the total amount

4. **Place the Order**
   - Click "Checkout" or "Place Order"
   - Confirm your order details
   - The system will:
     - Validate book availability
     - Select the best warehouse (one that has all items in stock)
     - Process your order
     - Show confirmation

5. **View Order Confirmation**
   - After successful order placement, you'll see:
     - Order ID
     - Order date
     - Items ordered with quantities
     - Total amount
     - Payment method
     - Fulfilling warehouse
     - Current status (PENDING → SHIPPED)

### How to View Your Orders

1. **Navigate to Orders Page**
   - While logged in, click "My Orders" or navigate to the Orders section

2. **View Order History**
   - See all your past orders
   - Each order shows:
     - Order date
     - Status (PENDING, SHIPPED)
     - Total amount
     - Items ordered

3. **Check Order Status**
   - **PENDING**: Order received, warehouse preparing shipment
   - **SHIPPED**: Order shipped, on its way to you

### How to View Warehouse Information

**Note**: The Warehouse Registry page is only accessible to Store Administrators. Customers will not see the "Warehouses" link in the navigation menu.

1. **Navigate to Warehouses Page** (Store Admin only)
   - Click "Warehouses" in the navigation menu
   - Only visible when logged in as Store Admin

2. **View Available Warehouses**
   - See all registered warehouses
   - Each warehouse shows:
     - Name (e.g., "Warehouse Alpha")
     - Status (HEALTHY, OFFLINE)
     - Last health check time
     - URL

3. **Understand Warehouse Status**
   - **HEALTHY**: Warehouse is operational and processing orders
   - **OFFLINE**: Warehouse is temporarily unavailable

---

## Store Administrator Guide

### How to Manage the Book Catalog

#### View All Books

1. **Login as Administrator**
   - Email: `admin@bookstore.com`
   - Password: `admin123`

2. **Navigate to Catalog Management**
   - Access the admin section
   - View all books in the system

#### Add a New Book

1. **Click "Add Book"**
2. **Fill in Book Details**:
   - Title (e.g., "The Great Gatsby")
   - Author (e.g., "F. Scott Fitzgerald")
   - ISBN (e.g., "978-0-7432-7356-5")
   - Price (e.g., 14.99)
   - Description
   - Published Year
   - Genre

3. **Save the Book**
   - Click "Save" or "Add Book"
   - Book appears in catalog
   - Initially has 0 inventory until warehouses stock it

#### Edit a Book

1. **Find the Book** in the catalog
2. **Click "Edit"** or select the book
3. **Update Fields** as needed
4. **Save Changes**

#### Remove a Book

1. **Find the Book** in the catalog
2. **Click "Delete"** or "Remove"
3. **Confirm Deletion**
   - Note: This marks the book as inactive
   - Existing orders are not affected

### How to View All Orders

1. **Navigate to Orders Management**
   - As admin, you can see ALL customer orders

2. **View Order Details**
   - Customer information
   - Order items and quantities
   - Payment details
   - Fulfillment warehouse
   - Current status

3. **Filter Orders**
   - By status (PENDING, SHIPPED)
   - By date range
   - By customer

### How to Monitor Warehouses

#### View Warehouse Registry

1. **Navigate to Warehouses Section**

2. **View All Registered Warehouses**
   - Name and location
   - Health status
   - Last seen timestamp
   - URL/endpoint

3. **Monitor Warehouse Health**
   - **HEALTHY**: Responding to health checks
   - **OFFLINE**: Not responding (may need attention)

#### Trigger Manual Inventory Reconciliation

If inventory numbers seem off:

1. **Navigate to Inventory Management**
2. **Click "Reconcile Inventory"** or similar button
3. **Wait for Process to Complete**
   - System queries all healthy warehouses
   - Updates inventory cache
   - Shows confirmation when done

4. **Verify Updated Inventory**
   - Check book catalog
   - Inventory numbers should reflect current warehouse stock

### How to View Inventory Cache

1. **Navigate to Inventory View**
2. **See Aggregated Inventory**:
   - Each book's total inventory
   - Breakdown by warehouse
   - Last sync time

3. **Understand the Data**:
   - Shows cached data (updated every 5 minutes)
   - May have slight delay vs. real-time
   - Last synced timestamp shows freshness

---

## Warehouse Staff Guide

### How to Access Your Warehouse

1. **Login with Warehouse Credentials**
   - For Alpha: `staff@warehouse-alpha.com` / `staff123`
   - For Beta: `staff@warehouse-beta.com` / `staff123`

2. **Navigate to Warehouse Section**
   - Select your warehouse from the UI
   - Or navigate directly to warehouse pages

### How to View Inventory

1. **Navigate to Inventory Page**
   - Click "Inventory" in the Warehouse section of the navigation menu
   - You'll see the Warehouse Inventory Management page

2. **Select Which Warehouse**
   - At the top of the page, choose between:
     - **Warehouse Alpha** button (blue when selected)
     - **Warehouse Beta** button
   - The inventory list updates automatically when you switch warehouses

3. **View Stock Levels**
   - Each book shows:
     - Title, Author, and ISBN
     - Current quantity in stock
     - Color-coded quantity badges:
       - **Green**: High stock (>10 units)
       - **Yellow**: Medium stock (1-10 units)
       - **Red**: Low/Out of stock (0 units)

4. **View Summary Stats**
   - Total unique books in the warehouse
   - Total quantity across all books

### How to Update Inventory

**Important**: You must be logged in as warehouse staff to update inventory.

1. **Select the Warehouse**
   - Use the warehouse selector buttons at the top
   - Choose "Warehouse Alpha" or "Warehouse Beta"

2. **Find the Book to Update**
   - Scroll through the inventory table
   - Each row has an "Edit" button

3. **Click the Edit Button**
   - A modal dialog will appear showing:
     - Book title, author, and ISBN
     - Current quantity
     - Input field for new quantity

4. **Enter New Quantity**
   - Type the new total quantity (not the amount to add)
   - For example: If current stock is 50 and you received 25 more, enter **75**
   - Quantity must be 0 or greater

5. **Save Changes**
   - Click "Save Changes" (green button)
   - The modal will close and the inventory table updates immediately
   - You'll see "Saving..." while the update processes
   - The Store will sync this data within 5 minutes

6. **Cancel if Needed**
   - Click "Cancel" (gray button) or click outside the modal
   - No changes will be saved

### How to View Shipments

1. **Navigate to Shipments Page**

2. **View Shipment History**
   - All orders fulfilled by your warehouse
   - Each shipment shows:
     - Order ID
     - Shipment date
     - Books and quantities shipped
     - Customer information (if available)

3. **Filter Shipments**
   - By date range
   - By book title
   - By order ID

### How to Process Shipment Requests

**Note**: Shipments are mostly automatic, but you can view the process:

1. **Incoming Shipment Request**
   - Store API sends shipment request to your warehouse
   - System automatically:
     - Validates inventory availability
     - Decrements stock levels
     - Logs the shipment
     - Confirms back to Store

2. **View Recent Shipments**
   - Check the Shipments page
   - Verify inventory was decremented
   - See shipment details

3. **Handle Failed Shipments**
   - If insufficient stock, shipment fails
   - You'll see error in logs
   - Customer order stays PENDING
   - Restock items to fulfill

### How to View Warehouse Info

1. **Navigate to Warehouse Dashboard**

2. **View Warehouse Details**:
   - Warehouse name and identifier
   - Registration status with Store
   - Health status
   - Total items in inventory
   - Total unique books
   - Recent activity

---

## Troubleshooting

### "Cannot Place Order - No Warehouse Available"

**Problem**: System can't find a warehouse with complete stock

**Solutions**:
1. Check inventory levels - one or more books may be out of stock
2. Wait for inventory reconciliation (runs every 5 minutes)
3. Reduce order quantity
4. Contact store admin to check warehouse health

### "Order Stuck in PENDING Status"

**Problem**: Order was placed but never shipped

**Possible Causes**:
1. Warehouse was offline during shipment request
2. Inventory was depleted after order placement
3. Communication error between Store and Warehouse

**Solutions**:
- **Customer**: Contact store admin
- **Store Admin**: Check warehouse health, review logs, may need to manually process
- **Warehouse Staff**: Check if order appears in your shipment logs

### "Inventory Shows 0 but Books Are in Stock"

**Problem**: Inventory cache is out of sync

**Solutions**:
1. Wait up to 5 minutes for automatic reconciliation
2. **Store Admin**: Trigger manual reconciliation
3. **Warehouse Staff**: Verify inventory was entered correctly in your system

### "Cannot Login"

**Problem**: Authentication fails

**Solutions**:
1. Verify you're using the correct email format
2. Check password (case-sensitive)
3. Ensure you're logging into the correct section (Store vs. Warehouse)
4. Try test credentials provided above
5. Contact system administrator

### "401 Unauthorized" or "403 Forbidden"

**Problem**: Getting unauthorized or forbidden errors when trying to access certain pages

**Root Cause**: Pages have role-based access control. Not all users can access all features.

**Solutions**:
- **If trying to view Warehouses Registry**: This page is only accessible to Store Administrators. Login with admin@bookstore.com to access it.
- **If trying to view Warehouse Inventory/Info**: These pages are only accessible to Warehouse Staff and Store Administrators. Login with appropriate credentials.
- **If you have the correct role**: Try logging out and logging back in to refresh your session.

**Page Access by Role**:
- **Customer**: Can access Catalog and My Orders
- **Warehouse Staff**: Can access Catalog, My Orders, Warehouse Inventory, and Warehouse Info
- **Store Admin**: Can access all pages including Warehouses Registry

### "Warehouse Shows OFFLINE"

**Problem**: Warehouse not responding to health checks

**Solutions**:
- **Warehouse Staff**: Not much you can do from UI - contact system admin
- **Store Admin**: Check Docker logs, may need to restart warehouse service
- **System Admin**: Run `docker compose logs warehouse-alpha` to diagnose

### "Book Not Appearing in Catalog"

**Problem**: Newly added book doesn't show up

**Solutions**:
1. Refresh the page
2. Check if book was saved successfully
3. Verify book is marked as "active" (not deleted)
4. Check browser console for errors

### "Page Not Loading / Errors"

**Problem**: UI shows errors or won't load

**Solutions**:
1. Refresh the page (Ctrl+R or Cmd+R)
2. Clear browser cache
3. Check if services are running: `docker compose ps`
4. Check browser console for specific error messages
5. Verify correct URL (http://localhost)

---

## Common Workflows

### Complete Customer Journey

1. **Browse** → Login not required
2. **Login** → Use customer credentials
3. **Add to Cart** → Select books and quantities
4. **Checkout** → Review and place order
5. **Confirmation** → Get order ID and status
6. **Track** → Check order status in My Orders

### Store Admin Daily Tasks

1. **Morning Check**:
   - Review overnight orders
   - Check warehouse health status
   - Verify inventory levels look correct

2. **Catalog Management**:
   - Add new book releases
   - Update prices or descriptions
   - Mark discontinued books as inactive

3. **Order Management**:
   - Review pending orders
   - Investigate any stuck orders
   - Handle customer inquiries

4. **Monitoring**:
   - Check warehouse status
   - Trigger reconciliation if needed
   - Review system health

### Warehouse Staff Daily Tasks

1. **Morning Check**:
   - Login as warehouse staff (`staff@warehouse-alpha.com:staff123`)
   - Navigate to Inventory page
   - Select your warehouse (Alpha or Beta)
   - Review overnight shipments
   - Check current inventory levels
   - Identify low stock items (shown in red/yellow)

2. **Receiving Inventory**:
   - When new books arrive:
     - Go to Inventory page
     - Select your warehouse
     - Find the book in the list
     - Click "Edit" button
     - Enter the new total quantity (old quantity + new arrivals)
     - Click "Save Changes"
   - Verify counts match receipts
   - The Store will sync updated inventory within 5 minutes

3. **Shipment Review**:
   - Check shipments processed
   - Verify inventory decrements automatically after shipments
   - Review any failed shipments in logs
   - Prepare physical shipments

4. **End of Day**:
   - Verify inventory counts
   - Report any discrepancies
   - Check for failed shipments

---

## Tips and Best Practices

### For Customers
- Check "Total Inventory" before placing large orders
- Orders are fulfilled from a single warehouse, so availability depends on warehouse stock distribution
- Order status updates automatically when warehouse ships

### For Store Admins
- Monitor warehouse health regularly (at least daily)
- Reconcile inventory if numbers seem off
- Keep warehouses balanced - distribute popular books across both warehouses
- Review PENDING orders that are older than expected

### For Warehouse Staff
- Update inventory promptly when receiving stock
- Double-check quantities before saving
- Report persistent issues to system admin
- Keep stock levels balanced to improve order fulfillment

---

## Getting Help

### For System Issues
- Check the [TROUBLESHOOTING](#troubleshooting) section above
- Review Docker logs: `docker compose logs -f`
- Contact your system administrator

### For Feature Questions
- Refer to this guide
- Check the [BOOKSTORE_ARCHITECTURE.md](../BOOKSTORE_ARCHITECTURE.md) for technical details
- Review [CLAUDE.md](../CLAUDE.md) for developer context

### For Business Questions
- Contact store management
- Review your role's capabilities in [User Roles](#user-roles)

---

## Appendix: System Behavior

### Order Fulfillment Logic

When you place an order:
1. System checks if books are in catalog
2. Calculates total price
3. Queries inventory cache to find warehouses with ALL items in stock
4. Selects first available warehouse
5. Creates order in PENDING status
6. Sends shipment request to warehouse
7. Warehouse validates and decrements inventory
8. Warehouse confirms shipment
9. Store updates order to SHIPPED
10. Store updates inventory cache

### Inventory Reconciliation

Every 5 minutes:
1. Store queries all HEALTHY warehouses
2. Requests full inventory list from each
3. Updates inventory_cache table
4. Sets last_synced timestamp

This ensures catalog shows current availability within 5-minute freshness.

### Warehouse Health Checks

Every 60 seconds:
1. Store pings all registered warehouses
2. Marks responsive warehouses as HEALTHY
3. Marks unresponsive warehouses as OFFLINE
4. Updates last_seen timestamp

Offline warehouses are not used for order fulfillment.

---

**Need More Help?** Contact your system administrator or refer to the technical documentation.
