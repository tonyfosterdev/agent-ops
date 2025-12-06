import { AppDataSource } from './database';
import { User } from './entities/User';
import { Book } from './entities/Book';
import { UserRole } from '@agentops/shared';
import bcrypt from 'bcrypt';

async function seedStore() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const bookRepo = AppDataSource.getRepository(Book);

  console.log('🌱 Seeding Store database...');

  // Seed Users
  const users = [
    {
      email: 'admin@bookstore.com',
      password: 'admin123',
      role: UserRole.STORE_ADMIN,
      first_name: 'Admin',
      last_name: 'User',
    },
    {
      email: 'alice@customer.com',
      password: 'alice123',
      role: UserRole.CUSTOMER,
      first_name: 'Alice',
      last_name: 'Johnson',
    },
    {
      email: 'bob@customer.com',
      password: 'bob123',
      role: UserRole.CUSTOMER,
      first_name: 'Bob',
      last_name: 'Smith',
    },
  ];

  for (const userData of users) {
    const existing = await userRepo.findOne({ where: { email: userData.email } });
    if (!existing) {
      const password_hash = await bcrypt.hash(userData.password, 10);
      const { password, ...userDataWithoutPassword } = userData;
      const user = userRepo.create({
        ...userDataWithoutPassword,
        password_hash,
      });
      await userRepo.save(user);
      console.log(`✅ Created user: ${userData.email}`);
    }
  }

  // Seed Books
  const books = [
    {
      isbn: '978-0-06-112008-4',
      title: 'To Kill a Mockingbird',
      author: 'Harper Lee',
      publisher: 'J. B. Lippincott & Co.',
      price: 14.99,
      genre: 'Fiction',
      publication_year: 1960,
      description: 'A gripping tale of racial injustice and childhood innocence.',
    },
    {
      isbn: '978-0-7432-7356-5',
      title: '1984',
      author: 'George Orwell',
      publisher: 'Secker & Warburg',
      price: 13.99,
      genre: 'Fiction',
      publication_year: 1949,
      description: 'A dystopian social science fiction novel.',
    },
    {
      isbn: '978-0-14-028329-5',
      title: 'The Great Gatsby',
      author: 'F. Scott Fitzgerald',
      publisher: "Charles Scribner's Sons",
      price: 12.99,
      genre: 'Fiction',
      publication_year: 1925,
      description: 'A novel about the American Dream in the Roaring Twenties.',
    },
    {
      isbn: '978-0-14-243724-7',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      publisher: 'T. Egerton',
      price: 11.99,
      genre: 'Fiction',
      publication_year: 1813,
      description: 'A romantic novel of manners.',
    },
    {
      isbn: '978-0-452-28423-4',
      title: 'The Catcher in the Rye',
      author: 'J.D. Salinger',
      publisher: 'Little, Brown and Company',
      price: 13.99,
      genre: 'Fiction',
      publication_year: 1951,
      description: 'A story about teenage rebellion and angst.',
    },
    {
      isbn: '978-0-06-093546-7',
      title: 'Brave New World',
      author: 'Aldous Huxley',
      publisher: 'Chatto & Windus',
      price: 14.99,
      genre: 'Science Fiction',
      publication_year: 1932,
      description: 'A dystopian novel set in a futuristic World State.',
    },
    {
      isbn: '978-0-06-112241-5',
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      publisher: 'George Allen & Unwin',
      price: 16.99,
      genre: 'Fantasy',
      publication_year: 1937,
      description: "A children's fantasy novel about Bilbo Baggins's adventure.",
    },
    {
      isbn: '978-0-547-92822-7',
      title: 'Harry Potter and the Sorcerer\'s Stone',
      author: 'J.K. Rowling',
      publisher: 'Bloomsbury',
      price: 17.99,
      genre: 'Fantasy',
      publication_year: 1997,
      description: 'The first novel in the Harry Potter series.',
    },
    {
      isbn: '978-0-553-21311-7',
      title: 'A Brief History of Time',
      author: 'Stephen Hawking',
      publisher: 'Bantam Books',
      price: 18.99,
      genre: 'Science',
      publication_year: 1988,
      description: 'A landmark volume in science writing.',
    },
    {
      isbn: '978-0-385-49081-8',
      title: 'Sapiens: A Brief History of Humankind',
      author: 'Yuval Noah Harari',
      publisher: 'Harper',
      price: 22.99,
      genre: 'Non-Fiction',
      publication_year: 2011,
      description: 'An exploration of the history and impact of Homo sapiens.',
    },
    {
      isbn: '978-1-59420-229-4',
      title: 'Educated',
      author: 'Tara Westover',
      publisher: 'Random House',
      price: 16.99,
      genre: 'Biography',
      publication_year: 2018,
      description: 'A memoir about a woman who grows up in a strict household.',
    },
    {
      isbn: '978-0-385-35668-4',
      title: 'Becoming',
      author: 'Michelle Obama',
      publisher: 'Crown Publishing',
      price: 19.99,
      genre: 'Biography',
      publication_year: 2018,
      description: 'A memoir by the former First Lady of the United States.',
    },
    {
      isbn: '978-0-06-231609-7',
      title: 'The Alchemist',
      author: 'Paulo Coelho',
      publisher: 'HarperOne',
      price: 14.99,
      genre: 'Fiction',
      publication_year: 1988,
      description: 'A philosophical novel about a young shepherd\'s journey.',
    },
    {
      isbn: '978-0-316-76948-0',
      title: 'The Da Vinci Code',
      author: 'Dan Brown',
      publisher: 'Doubleday',
      price: 15.99,
      genre: 'Mystery',
      publication_year: 2003,
      description: 'A mystery thriller novel.',
    },
    {
      isbn: '978-0-670-81302-4',
      title: 'The Power of Habit',
      author: 'Charles Duhigg',
      publisher: 'Random House',
      price: 17.99,
      genre: 'Self-Help',
      publication_year: 2012,
      description: 'Explores the science behind habit creation and reformation.',
    },
    {
      isbn: '978-1-59184-280-9',
      title: 'Atomic Habits',
      author: 'James Clear',
      publisher: 'Avery',
      price: 16.99,
      genre: 'Self-Help',
      publication_year: 2018,
      description: 'A practical guide to building good habits and breaking bad ones.',
    },
    {
      isbn: '978-0-06-085052-4',
      title: 'Outliers',
      author: 'Malcolm Gladwell',
      publisher: 'Little, Brown and Company',
      price: 18.99,
      genre: 'Non-Fiction',
      publication_year: 2008,
      description: 'Examines the factors that contribute to high levels of success.',
    },
    {
      isbn: '978-0-14-118280-3',
      title: 'Thinking, Fast and Slow',
      author: 'Daniel Kahneman',
      publisher: 'Farrar, Straus and Giroux',
      price: 20.99,
      genre: 'Psychology',
      publication_year: 2011,
      description: 'Explores the two systems that drive the way we think.',
    },
    {
      isbn: '978-0-307-58837-1',
      title: 'The Lean Startup',
      author: 'Eric Ries',
      publisher: 'Crown Business',
      price: 19.99,
      genre: 'Business',
      publication_year: 2011,
      description: 'A methodology for developing businesses and products.',
    },
    {
      isbn: '978-1-5011-2701-8',
      title: 'The Midnight Library',
      author: 'Matt Haig',
      publisher: 'Canongate Books',
      price: 15.99,
      genre: 'Fiction',
      publication_year: 2020,
      description: 'A novel about infinite possibilities and parallel lives.',
    },
  ];

  for (const bookData of books) {
    const existing = await bookRepo.findOne({ where: { isbn: bookData.isbn } });
    if (!existing) {
      const book = bookRepo.create(bookData);
      await bookRepo.save(book);
      console.log(`✅ Created book: ${bookData.title}`);
    }
  }

  console.log('✅ Store seeding completed');
  await AppDataSource.destroy();
}

seedStore().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});
