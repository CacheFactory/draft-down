const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: './src/renderer/index.tsx',
  target: 'web',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    conditionNames: ['import', 'module', 'browser', 'default'],
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
    },
  },
  externals: {
    'manifold-3d': 'commonjs manifold-3d',
    'opencascade.js': 'commonjs opencascade.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: 'renderer.js',
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
    }),
    new webpack.DefinePlugin({
      // Bug-report Lambda Function URL — host must also be in the CSP
      // connect-src of src/renderer/index.html
      '__BUG_REPORT_URL__': JSON.stringify(
        process.env.BUG_REPORT_URL || 'https://4ghrpkzeex7bnuacgrrzzco4oe0xvtdo.lambda-url.us-east-1.on.aws/',
      ),
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
  },
};
