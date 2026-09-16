# Report outbound INVITE responses without classification

Outbound call sessions emit `non2xxResponse` with the final SIP status code and reason phrase for every final non-2xx INVITE response, rather than interpreting responses such as 486, 487, or 603 as `busy`. This deliberately breaks the former `busy` event so applications can apply their own domain-specific classification without the SDK conflating busy, decline, cancellation, redirection, and other failures.
