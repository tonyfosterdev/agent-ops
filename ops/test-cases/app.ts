// Deliberately broken file with syntax and logical errors

function calculate(
  a, 
  b, 
  operation = 'multiply', 
  customErrorMessage
) {
  if (a === undefined || b === undefined) {
    throw new Error(customErrorMessage || `Invalid input`);
  }
  
  switch (operation) {
    case 'multiply':
      return a * b;
    case 'add':
      return a + b;
    case 'subtract':
      return a - b;
    case 'divide':
      if (b === 0) throw new Error('Division by zero is not allowed');
      return a / b;
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
}

const EXPECTED_RESULT = 35;

try {
  const result = calculate(5, 7);
  console.log(`Result: ${result}`);

  if (result === EXPECTED_RESULT) {
    console.log('✅ Success! The calculation is correct.');
    process.exit(0);
  } else {
    console.log('❌ Error! The calculation is incorrect.');
    console.log(`Expected: ${EXPECTED_RESULT}, Got: ${result}`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Calculation failed:', error);
  process.exit(1);
}