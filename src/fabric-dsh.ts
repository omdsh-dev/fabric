#!/usr/bin/env node
import { main } from './fabric-dsh/main.ts'

await main({ launcherUrl: import.meta.url })
