// Placeholder Lambda handler - will be implemented in Phase 2
export const handler = async (event: any) => {
  console.log('Image processor Lambda - placeholder');
  console.log('Event:', JSON.stringify(event, null, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Placeholder' }),
  };
};
