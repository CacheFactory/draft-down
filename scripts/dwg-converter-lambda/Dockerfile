# DraftDown DWG↔DXF converter — LibreDWG compiled into a Node 20 Lambda image.
# LibreDWG is GPLv3; it runs as a standalone service (separate process,
# separate deployment), never linked into the app.
FROM public.ecr.aws/lambda/nodejs:20

RUN dnf install -y gcc make tar gzip xz && dnf clean all

ARG LIBREDWG_VERSION=0.13.3
RUN curl -fL "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.gz" \
      -o /tmp/libredwg.tar.gz \
 && tar -xzf /tmp/libredwg.tar.gz -C /tmp \
 && cd "/tmp/libredwg-${LIBREDWG_VERSION}" \
 && ./configure --disable-bindings --disable-python --disable-perl --prefix=/opt/libredwg \
 && make -j"$(nproc)" \
 && make install \
 && rm -rf /tmp/libredwg*

ENV PATH="/opt/libredwg/bin:${PATH}"
ENV LD_LIBRARY_PATH="/opt/libredwg/lib"

COPY index.mjs ${LAMBDA_TASK_ROOT}/
CMD ["index.handler"]
