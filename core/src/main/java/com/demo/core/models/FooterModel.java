/*
 * Sling Model for the site footer: about column + Instagram image grid + Follow Us social row.
 */
package com.demo.core.models;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FooterModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String aboutHeading;

    @ValueMapValue
    private String aboutBody;

    @ValueMapValue
    private String instagramHeading;

    @ValueMapValue
    private String followHeading;

    @ChildResource
    private List<FooterInstagramItemModel> instagramItems;

    @ChildResource
    private List<FooterSocialItemModel> socialItems;

    @PostConstruct
    protected void init() {
        if (instagramItems == null) {
            instagramItems = Collections.emptyList();
        } else {
            instagramItems = instagramItems.stream()
                    .filter(FooterInstagramItemModel::isHasContent)
                    .collect(Collectors.toList());
        }
        if (socialItems == null) {
            socialItems = Collections.emptyList();
        } else {
            socialItems = socialItems.stream()
                    .filter(FooterSocialItemModel::isHasContent)
                    .collect(Collectors.toList());
        }
    }

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "furniture");
    }

    public String getAboutHeading() {
        return aboutHeading;
    }

    public String getAboutBody() {
        return aboutBody;
    }

    public String getInstagramHeading() {
        return instagramHeading;
    }

    public String getFollowHeading() {
        return followHeading;
    }

    public List<FooterInstagramItemModel> getInstagramItems() {
        return instagramItems;
    }

    public List<FooterSocialItemModel> getSocialItems() {
        return socialItems;
    }

    public boolean isHasInstagramItems() {
        return !instagramItems.isEmpty();
    }

    public boolean isHasSocialItems() {
        return !socialItems.isEmpty();
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(aboutHeading)
                || StringUtils.isNotBlank(aboutBody)
                || !instagramItems.isEmpty()
                || !socialItems.isEmpty();
    }
}
