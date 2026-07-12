export {};

const assets = await Array.fromAsync(new Bun.Glob('dist/assets/*.js').scan());

if (assets.length === 0) {
  throw new Error('Vite emitted no JavaScript entry asset.');
}

const largestAsset = Math.max(...assets.map((asset) => Bun.file(asset).size));
if (largestAsset > 500_000) {
  throw new Error(
    `Largest JavaScript asset is ${largestAsset} bytes; the 500 kB foundation budget regressed.`,
  );
}

const headlessAssets = assets.filter((asset) => asset.startsWith('dist/assets/headless-'));
if (headlessAssets.length !== 1) {
  throw new Error('The debug-only DevTools model must remain a separate lazy-loaded asset.');
}

console.log(
  `Verified ${assets.length} JavaScript asset(s); largest is ${largestAsset} bytes; DevTools stays lazy.`,
);
