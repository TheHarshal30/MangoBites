# Inji Verify 0.16 service, trusting the local JSON-LD context mirror (see docker/context-mirror).
FROM mosipid/inji-verify-service:0.16.0
USER root
COPY context-mirror-ca.crt /tmp/context-mirror-ca.crt
RUN keytool -importcert -cacerts -storepass changeit -noprompt -alias inji-playground-context-mirror -file /tmp/context-mirror-ca.crt
