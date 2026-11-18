/** 限制 ETF 净流入接口并发，避免 20 卡同时打上游 */
const MAX = 2
let active = 0
const waiters: Array<() => void> = []

function pump() {
  while (active < MAX && waiters.length) {
    const next = waiters.shift()
    next?.()
  }
}

export function withEtfFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1
      fn()
        .then(resolve, reject)
        .finally(() => {
          active -= 1
          pump()
        })
    }
    if (active < MAX) start()
    else waiters.push(start)
  })
}
