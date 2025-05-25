// Vercel Serverless Function for Notion API Proxy
// Optimized for Vercel Free Tier with caching and error handling

export default async function handler(req, res) {
  // Set CORS headers (already configured in vercel.json but adding for redundancy)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Validate request parameters
    const { endpoint } = req.query;
    if (!endpoint) {
      return res.status(400).json({ 
        error: 'Missing endpoint parameter',
        message: 'Please provide an endpoint parameter (e.g., ?endpoint=databases/DATABASE_ID)'
      });
    }

    // Validate authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Missing or invalid authorization header',
        message: 'Please provide a valid Bearer token in the Authorization header'
      });
    }

    // Construct Notion API URL
    const notionUrl = `https://api.notion.com/v1/${endpoint}`;
    
    // Prepare request headers for Notion API
    const notionHeaders = {
      'Authorization': authHeader,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Striks-Voice-Task-Manager/1.0'
    };

    // Prepare request body
    let requestBody = undefined;
    if (req.method !== 'GET' && req.body) {
      try {
        requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid request body',
          message: 'Request body must be valid JSON'
        });
      }
    }

    // Make request to Notion API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

    const notionResponse = await fetch(notionUrl, {
      method: req.method,
      headers: notionHeaders,
      body: requestBody,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle Notion API response
    let responseData;
    const contentType = notionResponse.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      responseData = await notionResponse.json();
    } else {
      responseData = await notionResponse.text();
    }

    // Add caching headers for successful GET requests
    if (req.method === 'GET' && notionResponse.ok) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes cache
    }

    // Return response with same status code as Notion API
    return res.status(notionResponse.status).json({
      success: notionResponse.ok,
      status: notionResponse.status,
      data: responseData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Notion API Proxy Error:', error);

    // Handle specific error types
    if (error.name === 'AbortError') {
      return res.status(408).json({
        error: 'Request timeout',
        message: 'The request to Notion API timed out. Please try again.'
      });
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Unable to connect to Notion API. Please check your internet connection.'
      });
    }

    // Generic error response
    return res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing your request.',
      timestamp: new Date().toISOString()
    });
  }
}