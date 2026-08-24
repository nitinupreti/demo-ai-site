/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ChallengeAcceptedModel {

    @ValueMapValue private String heading;
    @ValueMapValue private String audienceHeading;
    @ValueMapValue private String image;
    @ValueMapValue private String imageAlt;

    @ChildResource private List<LinkItem> ctas;
    @ChildResource private List<LinkItem> audiences;

    @PostConstruct
    protected void init() {
        ctas = filter(ctas);
        audiences = filter(audiences);
    }

    private static List<LinkItem> filter(List<LinkItem> input) {
        if (input == null) return Collections.emptyList();
        List<LinkItem> out = new ArrayList<>();
        for (LinkItem i : input) {
            if (i != null && StringUtils.isNotBlank(i.getLabel())) out.add(i);
        }
        return out;
    }

    public String getHeading() { return heading; }
    public String getAudienceHeading() { return audienceHeading; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public List<LinkItem> getCtas() { return ctas; }
    public List<LinkItem> getAudiences() { return audiences; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
            || (ctas != null && !ctas.isEmpty())
            || (audiences != null && !audiences.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class LinkItem {
        @ValueMapValue private String label;
        @ValueMapValue private String link;
        public String getLabel() { return label; }
        public String getLink() { return link; }
    }
}
