# Geometry Performance Tests

## Purpose

This test suite benchmarks the performance of DraftDown's core geometry operations to ensure they meet frame budget constraints and throughput targets. It measures execution time, memory usage, and throughput for mesh creation, extrusion, boolean operations, triangulation, and file I/O at various model complexity scales.

## What This Component Must Do

### Performance Benchmarks Required

**Mesh Creation Throughput**
- Measure faces per second when constructing new half-edge mesh structures
- Test at scales: 1K, 10K, 100K, 500K, 1M faces
- Report construction rate as faces/sec

**Extrude Operation Latency**
- Measure push/pull operation execution time
- Test on models ranging from 100 faces to 100K faces
- Record latency in milliseconds per operation
- Track memory allocation during operation

**Boolean Operation Latency**
- Measure union operation execution time
- Test on models from 1K to 100K faces
- Record latency in milliseconds per operation
- Track memory usage during manifold computation

**Triangulation Speed**
- Measure polygon-to-triangle conversion rate
- Test across different polygon complexities
- Report as polygons/sec

**Inference Engine Frame Budget**
- Verify that geometry inference computations complete within 2ms per frame
- Test during typical modeling operations
- Fail if frame budget is exceeded

**File Parse Speed**
- Measure OBJ, STL, and glTF file parsing throughput
- Test files ranging from 1MB to 100MB
- Report as MB/sec for each format

### Test Execution Requirements

- Total suite timeout: 120 seconds
- Must run in CI/CD pipeline
- Each benchmark must produce quantitative metrics
- Suite fails if any benchmark exceeds its defined budget
- Generate structured JSON output containing all benchmark results

### Test Data Dependencies

Must consume fixtures from Test Model Fixtures component:
- Pre-generated meshes at 1K, 10K, 100K, 500K, 1M face counts
- Sample files in OBJ, STL, and glTF formats at various sizes
- Models suitable for boolean operations (intersecting geometry)

## Components Under Test

**Half-Edge Mesh** (`mesh.halfedge`)
- Mesh construction performance
- Memory efficiency of half-edge data structure

**Manifold Solid Engine** (`solid.manifold`)
- Boolean operation latency
- Memory usage during solid operations

**Extrude (Push/Pull)** (`op.extrude`)
- Extrusion operation latency across model sizes
- Memory allocation patterns

**Boolean Union** (`op.boolean_union`)
- Union operation latency at various face counts
- Manifold computation overhead

**Manifold WASM Module** (`native.manifold`)
- WASM initialization overhead
- Cross-boundary data transfer costs

**Mesh Processing Worker** (`worker.mesh`)
- Web Worker message passing overhead
- Off-thread processing latency
- Worker pool efficiency

## Output Requirements

### Benchmark Result Format

Each test must output a JSON structure containing:
- Benchmark name
- Input size (face count, file size, etc.)
- Execution time (mean, min, max, stddev)
- Throughput metric (operations/sec, faces/sec, MB/sec)
- Memory usage (peak, average)
- Pass/fail status against budget
- Timestamp of execution

### Performance Budgets

Tests must fail if these thresholds are exceeded:
- Inference engine: > 2ms per frame
- Extrude on 10K face model: TBD (establish baseline)
- Boolean union on 10K face models: TBD (establish baseline)
- File parsing: < 10 MB/sec (fail threshold)

### Historical Tracking

Output format must support:
- Comparing results across test runs
- Detecting performance regressions
- Tracking trends over time

## Framework Requirements

- Must use Vitest as test framework
- Must be executable via standard npm test commands
- Must integrate with CI/CD pipeline
- Must report results in standard test output format
- Must support selective benchmark execution (tags/filters)

## Constraints

**No Cloud Dependencies**
- All benchmarks run entirely locally
- No external API calls
- No network-dependent measurements

**Determinism**
- Use fixed random seeds for generated geometry
- Minimize environmental variance
- Run multiple iterations and report statistics

**Isolation**
- Each benchmark must not interfere with others
- Clean up resources between tests
- Reset state before each measurement

**Repeatability**
- Same input must produce comparable results
- Document system requirements for benchmarks
- Control for garbage collection interference

## Dependencies

**Test Framework**
- Vitest (`lib.vitest`) for test execution and reporting

**Test Data**
- Test Model Fixtures (`test.fixture.models`) for pre-generated meshes and files

**Geometry Components**
- All listed components under test must be importable and executable

## Success Criteria

- All benchmarks complete within 120 second timeout
- All measurements produce valid numeric results
- Performance budgets are enforced
- JSON output is generated with complete metrics
- Suite passes in CI/CD environment
- Results are reproducible across runs