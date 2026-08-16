# Card art

Drop one image per card in here, named after the card id, and it appears on the
card face and on the board tile. Nothing else needs changing.

    src/ui/art/patkany.webp     ->  Patkány
    src/ui/art/argeo.webp       ->  Argeo

`.webp`, `.png`, `.jpg`, `.jpeg` and `.avif` are all picked up. The window is
4:3, so export at that ratio; 800x600 is plenty. Anything bigger is wasted
bandwidth on first load.
