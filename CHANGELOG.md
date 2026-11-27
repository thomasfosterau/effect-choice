# @thomasfosterau/effect-choice

## 0.1.0

### Minor Changes

- [#1](https://github.com/thomasfosterau/effect-choice/pull/1) [`2e9e4a6`](https://github.com/thomasfosterau/effect-choice/commit/2e9e4a669686e11bdbfbc5a87b0dd225f533fa32) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - First release: the `Choice` model of actors choosing outcomes (sealed mechanisms, sequential protocols and agents), `TieBreak` rules, and three families of mechanisms built on it, each with configurable rules. `Vote`: first past the post, plurality (SNTV), approval, Borda, instant runoff and the single transferable vote (Droop or Hare quota; last-bundle, inclusive or weighted inclusive Gregory surpluses; exclusions by transfer value or all at once). `Auction`: sealed-bid multi-unit auctions (pay-as-bid, uniform or first-rejected/Vickrey pricing; reserves; pro rata or by-lot rationing; higher- or lower-is-better bids) and Dutch and English clock auctions. `Draft`: linear and snake drafts with inserted and traded picks, and claims on players matched for free, by forfeit or with a points bill.
