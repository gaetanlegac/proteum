export default {
	test: {
		fileParallelism: false,
		globals: true,
		hookTimeout: 30000,
		include: ['tests/**/*.test.cjs', 'server/**/*.test.cjs'],
		testTimeout: 30000,
	},
};
