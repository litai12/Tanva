package apimart

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Only status GETs use this backoff. Submission must never be retried after
// acceptance. Retry-After may be delta-seconds or an HTTP date; the caller's
// original context and polling deadline bound even a long provider delay.
func nextImagePollRetryDelay(previous time.Duration, retryAfter string, now time.Time) time.Duration {
	delay := min(max(min(previous, time.Minute)*2, 5*time.Second), time.Minute)
	value := strings.TrimSpace(retryAfter)
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds >= 0 {
		// Saturate before converting seconds to nanoseconds.
		const maxDuration = time.Duration(1<<63 - 1)
		if seconds > int64(maxDuration/time.Second) {
			return maxDuration
		}
		return max(delay, time.Duration(seconds)*time.Second)
	}
	if date, err := http.ParseTime(value); err == nil {
		return max(delay, date.Sub(now))
	}
	return delay
}
