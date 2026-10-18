# Inji Certify 0.14 with the playground's standalone (no-eSignet, pre-authorized code) profile.
FROM mosipid/inji-certify-with-plugins:0.14.0
USER root
COPY certify-default.properties certify-playground.properties unused.csv /home/mosip/config/
# Trust the local JSON-LD context mirror (see docker/context-mirror).
COPY context-mirror-ca.crt /tmp/context-mirror-ca.crt
RUN keytool -importcert -cacerts -storepass changeit -noprompt -alias inji-playground-context-mirror -file /tmp/context-mirror-ca.crt
