-- Quick seed data for testing the UI

-- Insert books into store database
INSERT INTO books (id, title, author, isbn, price, genre, publication_year) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'The Great Gatsby', 'F. Scott Fitzgerald', '978-0743273565', 15.99, 'Fiction', 1925),
('550e8400-e29b-41d4-a716-446655440002', '1984', 'George Orwell', '978-0451524935', 13.99, 'Fiction', 1949),
('550e8400-e29b-41d4-a716-446655440003', 'To Kill a Mockingbird', 'Harper Lee', '978-0060935467', 14.99, 'Fiction', 1960),
('550e8400-e29b-41d4-a716-446655440004', 'Pride and Prejudice', 'Jane Austen', '978-0141439518', 12.99, 'Romance', 1813),
('550e8400-e29b-41d4-a716-446655440005', 'The Catcher in the Rye', 'J.D. Salinger', '978-0316769488', 14.99, 'Fiction', 1951),
('550e8400-e29b-41d4-a716-446655440006', 'Harry Potter and the Sorcerer''s Stone', 'J.K. Rowling', '978-0590353427', 19.99, 'Fantasy', 1997),
('550e8400-e29b-41d4-a716-446655440007', 'The Hobbit', 'J.R.R. Tolkien', '978-0547928227', 16.99, 'Fantasy', 1937),
('550e8400-e29b-41d4-a716-446655440008', 'Brave New World', 'Aldous Huxley', '978-0060850524', 15.99, 'Science Fiction', 1932),
('550e8400-e29b-41d4-a716-446655440009', 'The Lord of the Rings', 'J.R.R. Tolkien', '978-0544003415', 25.99, 'Fantasy', 1954),
('550e8400-e29b-41d4-a716-446655440010', 'Animal Farm', 'George Orwell', '978-0451526342', 11.99, 'Fiction', 1945);

-- Insert test users
INSERT INTO users (id, email, password_hash, role, first_name, last_name) VALUES
('650e8400-e29b-41d4-a716-446655440001', 'admin@store.com', '$2b$10$rT8qH9yJYqQ.YqWz0mKdE.nX3uQw0eZfKxYz1QzXm7J8gKqX9wK3u', 'STORE_ADMIN', 'Admin', 'User'),
('650e8400-e29b-41d4-a716-446655440002', 'customer@bookstore.com', '$2b$10$rT8qH9yJYqQ.YqWz0mKdE.nX3uQw0eZfKxYz1QzXm7J8gKqX9wK3u', 'CUSTOMER', 'Customer', 'Demo'),
('650e8400-e29b-41d4-a716-446655440003', 'alice@customer.com', '$2b$10$rT8qH9yJYqQ.YqWz0mKdE.nX3uQw0eZfKxYz1QzXm7J8gKqX9wK3u', 'CUSTOMER', 'Alice', 'Johnson');

