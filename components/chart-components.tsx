"use client"

import { TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, LabelList, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export const description = "A bar chart with a label"

const chartData = [
  { month: "January", desktop: 186 },
  { month: "February", desktop: 305 },
  { month: "March", desktop: 237 },
  { month: "April", desktop: 73 },
  { month: "May", desktop: 209 },
  { month: "June", desktop: 214 },
]

const chartConfig = {
  desktop: {
    label: "Desktop",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

export function ChartBarLabel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bar Chart - Label</CardTitle>
        <CardDescription>January - June 2024</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{
              top: 20,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="desktop" fill="var(--color-desktop)" radius={8}>
              <LabelList
                position="top"
                offset={12}
                className="fill-foreground"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 leading-none font-medium">
          Trending up by 5.2% this month <TrendingUp className="h-4 w-4" />
        </div>
        <div className="text-muted-foreground leading-none">
          Showing total visitors for the last 6 months
        </div>
      </CardFooter>
    </Card>
  )
}

// Registry of available chart components
export const chartComponents = {
  'chart-bar-label': ChartBarLabel,
  'chart-data-bar': ChartDataBar,
  'chart-data-line': ChartDataLine,
  'chart-data-0': (props: any) => ChartDataRenderer({ ...props, index: 0 }),
  'chart-data-1': (props: any) => ChartDataRenderer({ ...props, index: 1 }),
  'chart-data-2': (props: any) => ChartDataRenderer({ ...props, index: 2 }),
  'chart-data-3': (props: any) => ChartDataRenderer({ ...props, index: 3 }),
  'chart-data-4': (props: any) => ChartDataRenderer({ ...props, index: 4 }),
} as const

export type ChartComponentType = keyof typeof chartComponents

// Data-driven chart renderer
function ChartDataRenderer({ index, chartData, ...props }: { index: number; chartData?: any[] } & any) {
  console.log('ChartDataRenderer called with:', { index, chartDataCount: chartData ? chartData.length : 0, chartData });
  
  if (!chartData || !chartData[index]) {
    console.log('No chart data at index', index, 'chartData:', chartData);
    return (
      <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50 text-yellow-700">
        <div className="font-semibold mb-2">Chart Debug Information</div>
        <div>No chart data available for index {index}.</div>
        <div>Chart data received: {chartData ? chartData.length : 0} items</div>
        <div>Available indices: {chartData ? Object.keys(chartData).join(', ') : 'none'}</div>
        {chartData && chartData.length > 0 && (
          <div className="mt-2">
            <div className="font-medium">Available charts:</div>
            {chartData.map((chart, i) => (
              <div key={i} className="ml-2 text-sm">
                {i}: {chart?.title || 'Untitled'} ({chart?.type || 'unknown'}) - {chart?.data?.length || 0} data points
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-sm text-gray-600">
          Try using index 0-{chartData ? Math.max(0, chartData.length - 1) : 0} or check console for debugging info.
        </div>
      </div>
    )
  }

  const data = chartData[index]
  console.log('Chart data found at index', index, ':', data);
  
  if (!data.type || !data.data || !Array.isArray(data.data)) {
    console.log('Invalid chart data structure:', data);
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        <div className="font-semibold mb-2">Invalid Chart Data</div>
        <div>Chart data structure is invalid:</div>
        <pre className="text-xs mt-2 bg-gray-100 p-2 rounded">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    )
  }
  
  console.log('Rendering chart type:', data.type, 'with data:', data.data);
  
  switch (data.type) {
    case 'bar':
      return <ChartDataBar data={data} {...props} />
    case 'line':
      return <ChartDataLine data={data} {...props} />
    default:
      console.log('Unknown chart type, defaulting to bar:', data.type);
      return <ChartDataBar data={data} {...props} />
  }
}

// Dynamic bar chart component
function ChartDataBar({ data }: { data: any }) {
  console.log('ChartDataBar called with data:', data);
  
  if (!data || !data.data || !Array.isArray(data.data)) {
    console.log('ChartDataBar: Invalid data structure');
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        ChartDataBar: Invalid data structure
      </div>
    );
  }
  
  console.log('ChartDataBar: Processing chart with', data.data.length, 'data points');
  
  const chartConfig = {
    value: {
      label: data.yAxis || "Value",
      color: "hsl(var(--chart-1))",
    },
  } satisfies ChartConfig

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.title}</CardTitle>
        {data.description && (
          <CardDescription>
            {data.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart
            accessibilityLayer
            data={data.data}
            margin={{
              top: 20,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={8}>
              <LabelList
                position="top"
                offset={12}
                className="fill-foreground"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 font-medium leading-none">
          Data visualization from SQL analysis <TrendingUp className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing {data.data.length} data points
        </div>
      </CardFooter>
    </Card>
  )
}

// Dynamic line chart component
function ChartDataLine({ data }: { data: any }) {
  const chartConfig = {
    value: {
      label: data.yAxis || "Value",
      color: "hsl(var(--chart-1))",
    },
  } satisfies ChartConfig

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.title}</CardTitle>
        {data.description && (
          <CardDescription>
            {data.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          {/* Line chart would go here - using BarChart as placeholder */}
          <BarChart
            accessibilityLayer
            data={data.data}
            margin={{
              top: 20,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={8} />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 font-medium leading-none">
          Time series from SQL analysis <TrendingUp className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing {data.data.length} data points over time
        </div>
      </CardFooter>
    </Card>
  )
}

// Chart component renderer that can be used in documents
export function ChartComponent({ type, chartData, ...props }: { type: ChartComponentType; chartData?: any[] } & any) {
  console.log('ChartComponent called with:', { type, chartDataCount: chartData ? chartData.length : 0, props });
  
  const Component = chartComponents[type]
  
  if (!Component) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        Chart component "{type}" not found. Available types: {Object.keys(chartComponents).join(', ')}
      </div>
    )
  }
  
  return <Component chartData={chartData} {...props} />
} 