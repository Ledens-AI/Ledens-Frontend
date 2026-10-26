/**
 * English text for the service pages, keyed by slug. Same shape as the text
 * fields of servicios.js (images, icons and slugs stay there); bullets and
 * casos are in the same order as the Spanish ones.
 */
export const SERVICIOS_EN = {
  albanileria: {
    name: 'Masonry',
    hero: {
      eyebrow: 'Masonry · Málaga',
      title: ['Building work ', { em: 'without dust in your living room' }, '\nand with quality finishes.'],
      lead: 'Controlled demolition, tiling, flooring, plastering and façade repairs. We protect your home and leave it clean.',
    },
    bullets: [
      { t: 'Demolition and removal', s: 'Opening up walls, removing partitions and taking waste to an authorised tip.' },
      { t: 'Wall and floor tiling', s: 'Large-format porcelain with minimal joints and laser levelling.' },
      { t: 'Microcement and resins', s: 'Seamless finishes on floors, walls and walk-in showers.' },
      { t: 'Façade repairs', s: 'Repair, single-layer render or silicate and paint for community buildings.' },
      { t: 'Waterproofing', s: 'Roofs, terraces and bathrooms with bitumen membranes and liquid resins.' },
      { t: 'Dust protection', s: 'We seal off areas with plastic, seal doors and vacuum at the end of every day.' },
    ],
    casos: [
      { tag: 'Flat · Historic centre', title: 'Open-plan living-kitchen', body: 'Load-bearing wall removed and replaced with an IPE beam. Calculations and project included.' },
      { tag: 'Full renovation · Teatinos', title: 'Large-format flooring', body: '120×60 cm porcelain with 2 mm joints across a 95 m² home. A uniform finish.' },
      { tag: 'Bathroom · Pedregalejo', title: 'Microcement walk-in shower', body: 'Seamless microcement shower tray sloping to a linear drain.' },
    ],
    cta: {
      title: ['Need to knock down ', { em: 'a wall or retile?' }],
      subtitle: 'We work with plastic sheeting, an industrial vacuum and a spotless handover. Fixed-price quote in 24 h.',
    },
  },

  electricidad: {
    name: 'Electrical',
    hero: {
      eyebrow: 'Electrical · Málaga',
      title: ['Electrical installations ', { em: 'with no surprises on the bill' }, '\nor in the quote.'],
      lead: 'From the fuse board to the last socket. Installation certificate included and paperwork with the distribution company handled for you.',
    },
    bullets: [
      { t: 'Fuse board', s: 'Replacement or extension with latest-generation circuit breakers and RCDs.' },
      { t: 'Wiring and sockets', s: 'Wiring recessed in chases or trunking. UNE-HD 60364 standard.' },
      { t: 'Technical lighting', s: 'Recessed spotlights, LED strips and separate dimmable circuits.' },
      { t: 'EV charging points', s: 'Single-phase and three-phase wallboxes in a garage or parking space.' },
      { t: 'Home automation', s: 'Blinds, heating and security controlled from one app.' },
      { t: 'Certificate and registration', s: 'We file the certificate with Endesa / the distributor and give you a copy within 24 h.' },
    ],
    casos: [
      { tag: 'Flat · Teatinos', title: 'Complete rewiring', body: 'New fuse board, 34 light points and 12 sockets on separate circuits. 80 m².' },
      { tag: 'Villa · Costa del Sol', title: 'Wallbox + solar', body: 'Bidirectional Wallbox charger installed and connected to the existing solar panels.' },
      { tag: 'Business premises · Málaga centre', title: 'KNX home automation', body: 'Automated lighting, blinds and air conditioning in a 200 m² office.' },
    ],
    cta: {
      title: ['Is your wiring ', { em: 'more than 20 years old?' }],
      subtitle: 'We check it for free on the technical visit. Fixed-price quote in 24 h, works in 48 h.',
    },
  },

  fontaneria: {
    name: 'Plumbing',
    hero: {
      eyebrow: 'Plumbing · Málaga',
      title: ['Plumbing without ', { em: 'midnight\nleaks' }, ' or open-ended quotes.'],
      lead: 'We fix leaks, renew installations and fit complete bathrooms. A single point of contact and a fixed price before we start.',
    },
    bullets: [
      { t: 'Leak detection', s: 'Thermal camera and acoustic correlation. We find leaks without lifting the floor.' },
      { t: 'Pipe replacement', s: 'Lead or galvanised pipes replaced with PEX-AL-PEX multilayer or copper.' },
      { t: 'Complete bathrooms', s: 'Flush shower tray, screen, wall-hung toilet and made-to-measure vanity unit.' },
      { t: 'Heating installation', s: 'Condensing boiler, underfloor heating and low-consumption radiators.' },
      { t: 'Heat pumps and solar hot water', s: 'Heat pumps for domestic hot water and backup heating.' },
      { t: 'Industrial unblocking', s: 'Hydro-jetting, inspection camera and downpipe checks within 24 h.' },
    ],
    casos: [
      { tag: 'Bathroom · Tilos 57', title: 'Bathroom with walk-in shower', body: 'Full replacement of the installation. Walk-in shower with glass screen and microcement.' },
      { tag: 'Flat · El Palo', title: 'Complete pipe replacement', body: 'Lead to multilayer in a 1980 flat. Done over two weekends with no need to move out.' },
      { tag: 'Main bathroom · Tilos 57', title: 'Main bathroom renovated', body: 'Wall-hung toilet, floating vanity with integrated basin and thermostatic taps.' },
    ],
    cta: {
      title: ['Got a leak or ', { em: 'want a new bathroom?' }],
      subtitle: 'Free technical visit. Fixed-price quote in 24 h and a team working in 48 h.',
    },
  },

  climatizacion: {
    name: 'Heating & cooling',
    hero: {
      eyebrow: 'Heating & cooling · Málaga',
      title: ['Cool in August, warm in January,', { em: '\nwith no surprise\nbills.' }],
      lead: 'We install, replace and maintain heating and cooling systems for homes and businesses. Brand and model fixed in the quote.',
    },
    bullets: [
      { t: 'Split and multi-split', s: 'Mitsubishi, Daikin, Fujitsu and Panasonic. Clean installation in trunking or recessed.' },
      { t: 'Concealed ducts', s: 'Cassette or ducted fan-coil built into a plasterboard false ceiling.' },
      { t: 'Air-source heat pumps', s: 'A++ heat pump for hot water, heating and cooling in a single unit.' },
      { t: 'Underfloor heating', s: 'Electric or water-based, compatible with heat pumps.' },
      { t: 'Annual maintenance', s: 'Filter cleaning, gas check and electrical test. Annual contract.' },
      { t: 'Smart control', s: 'Wi-Fi and Tado thermostats: zone scheduling and remote control from your phone.' },
    ],
    casos: [
      { tag: 'Flat · Málaga Centro', title: '4×1 multi-split', body: '4 indoor units in a 3-bedroom flat. Concealed installation with painted trunking.' },
      { tag: 'Villa · Mijas Costa', title: 'Heat pump + underfloor heating', body: 'Gas boiler replaced with an air-source heat pump and water-based underfloor heating.' },
      { tag: 'Office · Teatinos', title: 'Ducted cassette', body: '5 zones of 40 m² controlled by KNX thermostats. Fitted in the existing false ceiling.' },
    ],
    cta: {
      title: ['Heating & cooling quote, ', { em: 'fixed in 24 h.' }],
      subtitle: 'Includes unit, installation and commissioning. No hidden refrigerant or connection costs.',
    },
  },

  pladur: {
    name: 'Drywall',
    hero: {
      eyebrow: 'Drywall · Málaga',
      title: ['New walls ', { em: 'without messy\nbuilding work' }, ' and with a 2-year guarantee.'],
      lead: 'Partitions, wall linings, seamless ceilings and fitted wardrobes. Clean work, a fixed deadline and a price that doesn’t change.',
    },
    bullets: [
      { t: 'Partition walls', s: 'Double board with rock wool: 52 dB sound insulation.' },
      { t: 'External wall lining', s: 'Better thermal insulation while losing no more than 7 cm of wall.' },
      { t: 'Seamless ceilings', s: 'Flat or stepped ceilings, with lighting and air conditioning built in.' },
      { t: 'Acoustic ceilings', s: 'Glass wool + sound-absorbing board for studios and meeting rooms.' },
      { t: 'Made-to-measure wardrobes', s: 'Plasterboard structure with lacquered or fabric-covered doors.' },
      { t: 'Finishing and painting', s: 'Filling, sanding and a first coat of paint included in the price.' },
    ],
    casos: [
      { tag: 'Flat · La Malagueta', title: 'Complete redistribution', body: 'All partitions removed and a new layout in plasterboard. From 3 to 4 bedrooms.' },
      { tag: 'Duplex · Centre', title: 'Acoustic ceiling, half floor', body: 'Floating ceiling with a rock-wool cavity under a wooden floor.' },
      { tag: 'Office · Teatinos', title: 'Plasterboard meeting room', body: 'Double RF60 board enclosure with a glass door. Visual and acoustic privacy.' },
    ],
    cta: {
      title: ['Want to ', { em: 'change the layout or improve insulation?' }],
      subtitle: 'No-obligation technical visit. Fixed-price quote in 24 h. Works start in 48 h.',
    },
  },

  carpinteria: {
    name: 'Carpentry',
    hero: {
      eyebrow: 'Carpentry · Málaga',
      title: ['Doors, wardrobes and ', { em: 'bespoke woodwork' }, '\nthat lasts for decades.'],
      lead: 'We make and fit solid wood, lacquered and melamine joinery. Fitted wardrobes, interior doors and oak flooring.',
    },
    bullets: [
      { t: 'Interior doors', s: 'Lacquered, solid wood and glass models. Anti-warp hardware included.' },
      { t: 'Fitted wardrobes', s: 'Built to plan, organised interiors and sliding or hinged doors.' },
      { t: 'Wooden flooring and parquet', s: 'Oak, walnut and ash. Floating or glued. Sanded and varnished on site.' },
      { t: 'Bespoke kitchens', s: 'Kitchen units in melamine, lacquer or solid wood with the worktop of your choice.' },
      { t: 'Wooden staircases', s: 'Step cladding and new banisters in oak or pine.' },
      { t: 'Wooden windows', s: 'Solid exterior joinery with double glazing and thermal break. Water-based paint.' },
    ],
    casos: [
      { tag: 'Bedroom · Tilos 57', title: 'Made-to-measure fitted wardrobe', body: '4 mirrored sliding doors. Interior with drawers and shoe rack. Floor to ceiling.' },
      { tag: 'Kitchen · Málaga Centro', title: 'Lacquered kitchen with island', body: 'Units lacquered in off-white, Silestone worktop and a solid oak island.' },
      { tag: 'Living room · Tilos 57', title: 'Floating oak flooring', body: '65 m² of European oak flooring in mixed widths. Quiet floating installation.' },
    ],
    cta: {
      title: ['What piece of ', { em: 'woodwork do you need?' }],
      subtitle: 'We send you a proposal with drawings in 24 h. Our own workshop, 2-year guarantee.',
    },
  },
};
