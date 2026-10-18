# Release 0.1.11

Fixed ordinary CommonMark emphasis resolution after a one-marker match. The
inline resolver now keeps linked delimiter lengths synchronized with the
remaining inline marker runs, so later rule-of-three checks preserve the
remaining opener instead of creating a spurious emphasis span.

Added a focused semantic regression for the reduced source
`**\`x\` d*$x$$*_x$*`. The public API and runtime pin are unchanged.
