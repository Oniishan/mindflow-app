package main

import (
	"os"
	"strings"
	"time"
)

func main() {
	f, _ := os.OpenFile(`Z:\tmp\sarun\edge-args.txt`, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	f.WriteString(strings.Join(os.Args[1:], " ") + "\n")
	f.Close()
	for {
		if _, err := os.Stat(`Z:\tmp\sarun\stop-edge`); err == nil {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}
