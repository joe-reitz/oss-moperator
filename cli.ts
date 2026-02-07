#!/usr/bin/env npx tsx
/**
 * mOperator CLI
 * Talk to your marketing stack in natural language
 */

import * as readline from "readline"
import { config } from "dotenv"

config({ path: ".env.local" })

const API_URL = process.env.MOPERATOR_API_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

interface Message {
  role: "user" | "assistant"
  content: string
}

const messages: Message[] = []

async function chat(userMessage: string): Promise<string> {
  messages.push({ role: "user", content: userMessage })

  const response = await fetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error: ${error}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let fullResponse = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    fullResponse += chunk
    process.stdout.write(chunk)
  }

  process.stdout.write("\n")
  messages.push({ role: "assistant", content: fullResponse })
  return fullResponse
}

async function main() {
  console.log(`
\x1b[32m         @@@                            @@@
        @@  @@                        @@  #
         @@   @@                    @@   @@
           @#   @@                @@   #@
             @=   @@            @@   =@
              @@.   @@        @@   -@@
                @@    @@    @@    @@
                  @@    @@@@    @@
                    @@   @    @@
                      @@    @@
                  @@@@    %#  @@@@
                @%...*  =@@.  =...@@
              @@=*#....@@  @@....#++@@
          @@@-.:=.*#=.@@    @%.=*+.==.=@@@
    @@*++=..+.+:*..:@@       @@@::.#:---..==++@@
 %:+..=..+--+.*+=*.@@          @%::#++.*-.+..=..=:#@
 @@@@@+..#+.@@.#...%@          @%...*.@@.*#..+@@@@@
 @=.....-..%..:*=*.#@          @#.+=*:..%..:.....=@
  @@@@%.*=:*.@.=.@*@@          @@*@:=.@.*:=+.@@@@@
    @..*.@.+.=-.@                  @.=..*.%.*..@
     @@@..=.@@@@@                  @@@@@.=..@@@
       @@@@@                            @@@@@\x1b[0m

              \x1b[1m┌┬┐┌─┐┌─┐┬─┐┌─┐┌┬┐┌─┐┬─┐\x1b[0m
              \x1b[1m││││ │├─┘├┤ ├┬┘├─┤ │ │ │├┬┘\x1b[0m
              \x1b[1m┴ ┴└─┘┴  └─┘┴└─┴ ┴ ┴ └─┘┴└─\x1b[0m
         \x1b[90mMarketing Operations AI Agent\x1b[0m
  `)
  console.log("  Your AI interface for Salesforce, Linear, GitHub, and more.")
  console.log("  Commands: 'clear' to reset, 'exit' to quit\n")

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question("\nmOperator > ", async (input) => {
      const trimmed = input.trim()

      if (!trimmed) { prompt(); return }

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\nGoodbye!\n")
        rl.close()
        process.exit(0)
      }

      if (trimmed.toLowerCase() === "clear") {
        messages.length = 0
        console.log("Conversation cleared.")
        prompt()
        return
      }

      try {
        await chat(trimmed)
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : error)
      }

      prompt()
    })
  }

  prompt()
}

main().catch(console.error)
