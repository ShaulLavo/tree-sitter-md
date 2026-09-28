import { check } from './check.mjs'
console.log(JSON.stringify(await check(process.argv[2])))
