# The API gateway with its configuration baked in.
#
# Both Supabase stacks build this from the repository (compose `build:`), so
# a change to any file here reaches the gateway with a normal deploy: a new
# image, and compose recreates the container. With the files bind-mounted
# instead, a deploy left the running Envoy on the old config until someone
# restarted it, and prod needed the files pasted into Dokploy by hand.
#
# Build context is the repository root. The two keys are not in the image:
# docker-entrypoint.sh fills them into lds.yaml from the environment at start.
FROM envoyproxy/envoy:v1.39.1

COPY docker/envoy/envoy.yaml docker/envoy/cds.yaml docker/envoy/lds.template.yaml /etc/envoy/
COPY docker/envoy/docker-entrypoint.sh /docker-entrypoint.sh
