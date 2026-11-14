// Local artwork supplied for Shinobi Signs. Failed image loads fall back to Canvas art.
export function loadGameAssets() {
  const load = (src) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    return image;
  };
  return {
    shadowFighter: load('./assets/fighter-shadow.png'),
    crimsonFighter: load('./assets/fighter-crimson-cutout.png'),
    arena: load('./assets/arena-hyrule.jpg'),
    orb: load('./assets/energy-orb.png'),
    clash: load('./assets/jutsu-clash.png'),
  };
}
