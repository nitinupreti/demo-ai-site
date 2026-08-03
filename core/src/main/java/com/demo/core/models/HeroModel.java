/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model for the Positivus Hero component.
 */
@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroModel {

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String body;

    @ValueMapValue
    @Default(values = "")
    private String ctaText;

    @ValueMapValue
    @Default(values = "#")
    private String ctaLink;

    @ValueMapValue
    private String illustration;

    @ValueMapValue
    @Default(values = "")
    private String illustrationAlt;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        hasContent = StringUtils.isNotBlank(heading)
                || StringUtils.isNotBlank(body)
                || StringUtils.isNotBlank(illustration);
    }

    public String getHeading() { return heading; }
    public String getBody() { return body; }
    public String getCtaText() { return ctaText; }
    public String getCtaLink() { return ctaLink; }
    public String getIllustration() { return illustration; }
    public String getIllustrationAlt() { return illustrationAlt; }
    public boolean isHasContent() { return hasContent; }
}
