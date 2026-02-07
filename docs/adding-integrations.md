# Adding Custom Integrations

This guide explains how to add a new integration to mOperator. For example, you might want to connect to a weather API, a custom internal tool, or a SaaS platform.

An integration is a self-contained module that teaches mOperator about an external service.

## Integration Structure

Each integration lives in `src/lib/integrations/<service_name>/` with three files:

```
src/lib/integrations/myservice/
├── client.ts          # API client (handles authentication, requests)
├── tools.ts           # AI SDK tools (what the AI can do)
└── index.ts           # Module export (describes the integration)
```

## Step 1: Create the Folder

```bash
mkdir -p src/lib/integrations/myservice
```

## Step 2: Create the API Client (`client.ts`)

This file handles all communication with your external service.

```typescript
// src/lib/integrations/myservice/client.ts

const API_KEY = process.env.MYSERVICE_API_KEY
const API_BASE = 'https://api.myservice.com'

export async function getWeather(city: string): Promise<{
  temp: number
  description: string
  icon: string
}> {
  if (!API_KEY) throw new Error('MYSERVICE_API_KEY not configured')

  const response = await fetch(`${API_BASE}/weather?city=${encodeURIComponent(city)}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  })

  if (!response.ok) {
    throw new Error(`Weather API error: ${response.statusText}`)
  }

  return response.json()
}

export async function getForecast(city: string, days: number = 5): Promise<{
  date: string
  temp: number
  description: string
}[]> {
  if (!API_KEY) throw new Error('MYSERVICE_API_KEY not configured')

  const response = await fetch(
    `${API_BASE}/forecast?city=${encodeURIComponent(city)}&days=${days}`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  )

  if (!response.ok) {
    throw new Error(`Forecast API error: ${response.statusText}`)
  }

  return response.json()
}
```

**Best practices:**
- Check env vars early, throw clear errors
- Use meaningful error messages
- Return typed data (use TypeScript interfaces)
- Handle API errors gracefully

## Step 3: Create AI SDK Tools (`tools.ts`)

This file defines what the AI model can do with your service. Each tool is a function the AI can call.

```typescript
// src/lib/integrations/myservice/tools.ts

import { tool } from 'ai'
import { z } from 'zod'
import * as client from './client'

export const myserviceTools = {
  getWeather: tool({
    description: 'Get current weather for a city',
    inputSchema: z.object({
      city: z.string().describe('City name (e.g., "San Francisco")'),
    }),
    execute: async ({ city }) => {
      try {
        const weather = await client.getWeather(city)
        return {
          success: true as const,
          city,
          temp: weather.temp,
          description: weather.description,
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }),

  getForecast: tool({
    description: 'Get weather forecast for a city over multiple days',
    inputSchema: z.object({
      city: z.string().describe('City name'),
      days: z.number().optional().describe('Number of days (default 5)'),
    }),
    execute: async ({ city, days }) => {
      try {
        const forecast = await client.getForecast(city, days)
        return {
          success: true as const,
          city,
          forecast: forecast.map(day => ({
            date: day.date,
            temp: day.temp,
            description: day.description,
          })),
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }),
}
```

**Important:**
- Use `tool()` from the `ai` package
- Define `inputSchema` using Zod (NOT `parameters`)
- Always return `{ success: true/false, ... }` format
- If a tool fails, return `success: false` with an error message
- Do NOT fabricate or hallucinate data — return real results or fail
- Use `.describe()` to explain parameters to the AI

## Step 4: Create the Module Export (`index.ts`)

This file tells mOperator about your integration.

```typescript
// src/lib/integrations/myservice/index.ts

import type { Integration } from '../types'
import { myserviceTools } from './tools'

export const myserviceIntegration: Integration = {
  name: 'Weather Service',
  description: 'Real-time weather data and forecasts',
  capabilities: [
    'Get current weather for any city',
    'View 5-day weather forecast',
    'Check temperature and conditions',
  ],
  examples: [
    'What\'s the weather in New York?',
    'Show me the forecast for San Francisco',
    'Is it going to rain tomorrow in Seattle?',
  ],
  isConfigured: () => {
    return !!process.env.MYSERVICE_API_KEY
  },
  getTools: () => myserviceTools,
}
```

**What each field does:**
- `name` — Display name in system prompts
- `description` — One-line summary
- `capabilities` — List of things the AI can do (shown to users)
- `examples` — Sample prompts users can try
- `isConfigured()` — Check if required env vars exist (return false if not)
- `getTools()` — Return the tools object from tools.ts

## Step 5: Register the Integration

Add your integration to the loader:

```typescript
// src/lib/integrations/index.ts (existing file)

// Add at the top with other imports:
import { myserviceIntegration } from './myservice'

// Add to the ALL_INTEGRATIONS array:
const ALL_INTEGRATIONS: Integration[] = [
  salesforceIntegration,
  linearIntegration,
  githubIntegration,
  myserviceIntegration,  // ← Add your integration here
]
```

## Step 6: Set Environment Variable

mOperator uses env vars to discover integrations. Add to `.env.local`:

```bash
MYSERVICE_API_KEY=your-api-key-here
```

## Step 7: Test

Restart your app:

```bash
npm run dev
```

Test in Slack:

```
@mOperator what's the weather in Paris?
```

or via CLI:

```bash
npm run cli
```

Then type:

```
what's the weather in London?
```

## Complete Example: Weather Integration

Here's a working example you can use as a template:

### `src/lib/integrations/weather/client.ts`

```typescript
const API_KEY = process.env.WEATHER_API_KEY
const API_BASE = 'https://api.open-meteo.com/v1'

interface WeatherData {
  temp: number
  description: string
  condition: string
}

export async function getWeather(lat: number, lon: number): Promise<WeatherData> {
  if (!API_KEY) throw new Error('WEATHER_API_KEY not set')

  const url = new URL(`${API_BASE}/forecast`)
  url.searchParams.append('latitude', lat.toString())
  url.searchParams.append('longitude', lon.toString())
  url.searchParams.append('current', 'temperature_2m,weather_code')

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Weather API: ${response.statusText}`)

  const data: any = await response.json()
  return {
    temp: data.current.temperature_2m,
    condition: describeWeatherCode(data.current.weather_code),
    description: `${data.current.temperature_2m}°C`,
  }
}

function describeWeatherCode(code: number): string {
  const codes: Record<number, string> = {
    0: 'clear',
    1: 'cloudy',
    2: 'cloudy',
    3: 'overcast',
    45: 'foggy',
    48: 'foggy',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'heavy drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    71: 'slight snow',
    73: 'moderate snow',
    75: 'heavy snow',
    77: 'snow grains',
  }
  return codes[code] || 'unknown'
}
```

### `src/lib/integrations/weather/tools.ts`

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import * as client from './client'

// Mock coordinates (in real integration, use a geocoding API)
const CITIES: Record<string, [number, number]> = {
  'new york': [40.7128, -74.0060],
  'london': [51.5074, -0.1278],
  'tokyo': [35.6762, 139.6503],
  'paris': [48.8566, 2.3522],
}

export const weatherTools = {
  getCurrentWeather: tool({
    description: 'Get current weather for a city',
    inputSchema: z.object({
      city: z.string().describe('City name (e.g., "New York", "London")'),
    }),
    execute: async ({ city }) => {
      try {
        const coords = CITIES[city.toLowerCase()]
        if (!coords) {
          return {
            success: false as const,
            error: `City not supported: ${city}. Try: ${Object.keys(CITIES).join(', ')}`,
          }
        }

        const weather = await client.getWeather(coords[0], coords[1])
        return {
          success: true as const,
          city,
          ...weather,
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to fetch weather',
        }
      }
    },
  }),
}
```

### `src/lib/integrations/weather/index.ts`

```typescript
import type { Integration } from '../types'
import { weatherTools } from './tools'

export const weatherIntegration: Integration = {
  name: 'Weather',
  description: 'Real-time weather and forecasts',
  capabilities: [
    'Get current weather for major cities',
    'Check temperature and conditions',
  ],
  examples: [
    'What\'s the weather in New York?',
    'Is it raining in London?',
  ],
  isConfigured: () => !!process.env.WEATHER_API_KEY,
  getTools: () => weatherTools,
}
```

## Common Patterns

### Authentication

**API Key in header:**
```typescript
headers: { 'Authorization': `Bearer ${API_KEY}` }
```

**API Key in URL:**
```typescript
const url = new URL('https://api.service.com/endpoint')
url.searchParams.append('key', API_KEY)
```

**OAuth tokens:**
```typescript
headers: {
  'Authorization': `Bearer ${ACCESS_TOKEN}`,
}
```

### Error Handling

Always return structured results:

```typescript
execute: async (input) => {
  try {
    const data = await client.fetchData(input)
    return {
      success: true as const,
      data,
      message: 'Successfully fetched data',
    }
  } catch (error) {
    console.error('Tool error:', error)
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

### Multiple Tools

You can have many tools in one integration:

```typescript
export const myserviceTools = {
  getThing: tool({ ... }),
  createThing: tool({ ... }),
  deleteThing: tool({ ... }),
  listThings: tool({ ... }),
}
```

## Debugging

**Check if integration is loaded:**
```bash
npm run cli
```

Type:
```
list my capabilities
```

If your integration appears, it's loaded.

**Enable verbose logging:**
```typescript
console.log('[MyService] Action:', action)
```

Then check logs when testing.

## Best Practices

1. **Check env vars early** — Fail fast if configuration is missing
2. **Return clear errors** — Users need to know what went wrong
3. **Use proper types** — TypeScript catches bugs
4. **Document capabilities** — Help the AI understand what it can do
5. **Test before deploying** — Use `npm run cli` locally
6. **Never fabricate data** — Return real results or fail with an error
7. **Handle rate limits** — If your API has limits, add retries or caching
8. **Be specific with descriptions** — Help the AI understand when to use each tool

## Next Steps

1. Test your integration locally with `npm run cli`
2. Deploy to Vercel
3. Test in Slack
4. Add documentation in your repo's README
5. Share with your team!
